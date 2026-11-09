"""FastAPI backend for the CV Studio web app.

Start with:  python -m cvgen web      (opens http://127.0.0.1:8765)
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import knowledge as knowledge_mod
from .. import tailor as tailor_mod
from .. import template_convert
from ..guard import apply_guard, full_plan
from ..job import JobFetchError, fetch_job
from ..llm import LLMError, make_client
from ..models import JobPosting, TailoringPlan
from ..profile import ProfileError
from ..render import RenderError, _find_soffice, docx_to_pdf, pdf_to_images, render_docx
from ..report import build_report
from ..sources import SourceError
from ..template_convert import TemplateError
from ..workspace import Workspace, now

STATIC = Path(__file__).parent / "static"

USER_ERRORS = (LLMError, JobFetchError, ProfileError, RenderError, SourceError, TemplateError)


# --------------------------------------------------------------------------- #
# Background tasks (LLM calls take 30 s - 3 min)
# --------------------------------------------------------------------------- #
class Tasks:
    def __init__(self):
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.items: dict[str, dict] = {}
        self.lock = threading.Lock()

    def submit(self, label: str, fn, *args) -> str:
        tid = uuid.uuid4().hex[:12]
        task = {"id": tid, "label": label, "status": "running", "step": "Starting…", "result": None,
                "error": None, "started": now()}
        with self.lock:
            self.items[tid] = task

        def step(msg: str):
            task["step"] = msg

        def run():
            try:
                task["result"] = fn(step, *args)
                task["status"] = "done"
            except USER_ERRORS as exc:
                task["status"], task["error"] = "error", str(exc)
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc()
                task["status"], task["error"] = "error", f"Unexpected error: {exc}"

        self.pool.submit(run)
        return tid

    def get(self, tid: str) -> dict:
        if tid not in self.items:
            raise HTTPException(404, "Unknown task")
        return self.items[tid]


# --------------------------------------------------------------------------- #
# Request bodies
# --------------------------------------------------------------------------- #
class SettingsIn(BaseModel):
    model: Optional[str] = None
    effort: Optional[str] = None
    api_key: Optional[str] = None
    default_template: Optional[str] = None


class YamlIn(BaseModel):
    yaml: str


class UrlIn(BaseModel):
    url: str
    kind: str = ""


class KindIn(BaseModel):
    kind: str


class BuildIn(BaseModel):
    source_ids: list[str]


class GenerateIn(BaseModel):
    job_url: str = ""
    job_text: str = ""
    template_id: str = ""
    strict: bool = False


class RerenderIn(BaseModel):
    template_id: str


# --------------------------------------------------------------------------- #
# App factory
# --------------------------------------------------------------------------- #
def create_app(workspace: Workspace | None = None) -> FastAPI:
    ws = workspace or Workspace()
    tasks = Tasks()
    app = FastAPI(title="CV Studio")
    app.state.ws = ws

    def client():
        key = ws.api_key()
        if not key:
            raise LLMError("No Anthropic API key configured. Add it under Settings.")
        return make_client(key)

    def require_profile():
        try:
            profile = ws.load_profile()
        except ProfileError as exc:
            raise HTTPException(400, str(exc)) from exc
        if profile is None:
            raise HTTPException(400, "Your knowledge base is empty. Add sources under Knowledge first.")
        return profile

    @app.exception_handler(FileNotFoundError)
    async def not_found(_, exc):
        return JSONResponse({"detail": "Not found"}, status_code=404)

    # ------------------------------------------------------------------ state
    @app.get("/api/state")
    def state():
        profile, profile_error = None, None
        try:
            profile = ws.load_profile()
        except ProfileError as exc:
            profile_error = str(exc)
        s = ws.settings()
        stats = None
        if profile:
            stats = {
                "name": profile.personal.name,
                "experience": len(profile.experience),
                "bullets": sum(len(e.bullets) for e in profile.experience),
                "skills": len(profile.skills),
                "education": len(profile.education),
                "projects": len(profile.projects),
                "certifications": len(profile.certifications),
                "publications": len(profile.publications),
                "languages": len(profile.languages),
            }
        return {
            "profile": stats, "profile_error": profile_error,
            "sources": len(ws.list_sources()), "templates": len(ws.list_templates()),
            "applications": ws.list_applications()[:5],
            "api_key": bool(ws.api_key()), "api_key_from_env": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "model": s["model"], "pdf": bool(_find_soffice()), "default_template": ws.default_template_id(),
        }

    @app.get("/api/tasks/{tid}")
    def task(tid: str):
        t = tasks.get(tid)
        return {k: t[k] for k in ("id", "label", "status", "step", "result", "error")}

    # ------------------------------------------------------------------ settings

    @app.get("/api/settings")
    def get_settings():
        s = ws.settings()
        key = s.pop("api_key", "")
        s["api_key_set"] = bool(key)
        s["api_key_hint"] = f"…{key[-4:]}" if key else ""
        return s

    @app.put("/api/settings")
    def put_settings(body: SettingsIn):
        data = {k: v for k, v in body.model_dump().items() if v is not None}
        ws.save_settings(data)
        return get_settings()

    # ------------------------------------------------------------------ profile

    @app.get("/api/profile")
    def get_profile():
        profile = None
        try:
            profile = ws.load_profile()
        except ProfileError:
            pass
        return {"yaml": ws.profile_yaml(), "profile": profile.model_dump() if profile else None}

    @app.put("/api/profile")
    def put_profile(body: YamlIn):
        try:
            ws.save_profile_yaml(body.yaml)
        except ProfileError as exc:
            raise HTTPException(400, f"Not saved: {exc}") from exc
        refresh_previews_later()
        return get_profile()

    # ------------------------------------------------------------------ sources
    @app.get("/api/sources")
    def list_sources():
        return ws.list_sources()

    @app.post("/api/sources")
    async def upload_sources(files: list[UploadFile] = File(...), kind: str = Form("")):
        added, errors = [], []
        for f in files:
            try:
                added.append(ws.add_source(f.filename or "upload", await f.read(), kind or None))
            except SourceError as exc:
                errors.append(f"{f.filename}: {exc}")
        return {"added": added, "errors": errors}


    @app.post("/api/sources/url")
    def add_url(body: UrlIn):
        try:
            return ws.add_url_source(body.url, body.kind or None)
        except SourceError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.get("/api/sources/{sid}/text")
    def source_text(sid: str):
        return {"text": ws.source_text(sid)}

    @app.patch("/api/sources/{sid}")
    def set_source_kind(sid: str, body: KindIn):
        if body.kind not in {"cv", "linkedin", "xing", "other"}:
            raise HTTPException(400, "Unknown kind")
        return ws.set_source_kind(sid, body.kind)

    @app.delete("/api/sources/{sid}")
    def delete_source(sid: str):
        ws.delete("sources", sid)
        return {"ok": True}

    # ------------------------------------------------------------------ knowledge

    def _build(step, source_ids):
        try:
            current = ws.load_profile()
        except ProfileError:
            current = None
        sources = [ws.load_source(s) for s in source_ids]
        step(f"Claude is reading {len(sources)} source(s) and updating your knowledge base…")
        s = ws.settings()
        proposal = knowledge_mod.build_knowledge(current, sources, model=s["model"], effort=s["effort"],
                                                 client=client())
        return {"proposal_id": ws.save_proposal(proposal)}

    @app.post("/api/knowledge/build")
    def build(body: BuildIn):
        if not body.source_ids:
            raise HTTPException(400, "Select at least one source.")
        return {"task_id": tasks.submit("Build knowledge base", _build, body.source_ids)}

    @app.get("/api/proposals/{pid}")
    def get_proposal(pid: str):
        return json.loads(ws.load_proposal(pid).model_dump_json())

    @app.post("/api/proposals/{pid}/apply")
    def apply_proposal(pid: str):
        proposal = ws.load_proposal(pid)
        if proposal.errors:
            raise HTTPException(400, "The proposal has errors: " + "; ".join(proposal.errors))
        ws.save_profile(proposal.result.profile)
        ws.delete_proposal(pid)
        refresh_previews_later()
        return {"ok": True}

    @app.delete("/api/proposals/{pid}")
    def discard_proposal(pid: str):
        ws.delete_proposal(pid)
        return {"ok": True}

    # ------------------------------------------------------------------ templates
    def _preview(tid: str) -> None:
        """Render the template with the full profile (if any) to validate it and make a preview."""
        profile = ws.load_profile()
        d = ws.template_path(tid).parent
        if profile is None:
            return
        ctx, _ = apply_guard(profile, full_plan(profile))
        out = render_docx(ctx, d / "template.docx", d / "preview.docx")
        if _find_soffice():
            pdf = docx_to_pdf(out, d)
            pdf_to_images(pdf, d, "preview")
        (d / "preview.docx").unlink(missing_ok=True)

    def _refresh_all_previews(step):
        for t in ws.list_templates():
            step(f"Rendering preview of {t['name']}…")
            try:
                _preview(t["id"])
            except Exception as exc:  # noqa: BLE001 - a broken template must not stop the others
                print(f"Preview of {t['id']} failed: {exc}")
        return {}

    def refresh_previews_later():
        if _find_soffice():
            tasks.submit("Refresh template previews", _refresh_all_previews)

    def _convert(step, name, data):
        step("Claude is analysing your CV layout…")
        converted, spec = template_convert.convert_with_llm(data, model=ws.settings()["model"], client=client())
        meta = ws.add_template(name, converted, "converted", spec.notes)
        step("Rendering a preview with your knowledge base…")
        try:
            _preview(meta["id"])
        except Exception as exc:  # noqa: BLE001
            ws.delete("templates", meta["id"])
            raise TemplateError(f"The converted template could not be rendered ({exc}). "
                                "Try again, or tag the template by hand (see README).") from exc
        return {"template_id": meta["id"]}

    @app.get("/api/templates")
    def list_templates():
        return ws.list_templates()

    @app.post("/api/templates")
    async def upload_template(file: UploadFile = File(...), name: str = Form("")):
        if not (file.filename or "").lower().endswith(".docx"):
            raise HTTPException(400, "Please upload a Word document (.docx). In Word: File → Save as → .docx")
        data = await file.read()
        name = name or Path(file.filename).stem
        try:
            tagged = template_convert.is_template(data)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, f"Could not read this Word file: {exc}") from exc
        if tagged:
            meta = ws.add_template(name, data, "uploaded")
            try:
                _preview(meta["id"])
            except Exception as exc:  # noqa: BLE001
                ws.delete("templates", meta["id"])
                raise HTTPException(400, f"Template error: {exc}") from exc
            return {"template_id": meta["id"]}
        return {"task_id": tasks.submit("Convert CV into template", _convert, name, data)}

    @app.post("/api/templates/{tid}/preview")
    def refresh_preview(tid: str):
        try:
            _preview(tid)
        except USER_ERRORS as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"ok": True}

    @app.get("/api/templates/{tid}/preview.pdf")
    def template_preview(tid: str):
        return FileResponse(ws.template_path(tid).parent / "preview.pdf", media_type="application/pdf")

    @app.get("/api/templates/{tid}/pages/{n}.png")
    def template_page(tid: str, n: int):
        return FileResponse(ws.template_path(tid).parent / f"preview-{n}.png", media_type="image/png",
                            headers={"Cache-Control": "no-store"})

    @app.get("/api/templates/{tid}/template.docx")
    def template_file(tid: str):
        meta = next((t for t in ws.list_templates() if t["id"] == tid), {"name": tid})
        return FileResponse(ws.template_path(tid), filename=f"{meta['name']}.docx")

    @app.post("/api/templates/{tid}/default")
    def set_default(tid: str):
        ws.template_path(tid)
        ws.save_settings({"default_template": tid})
        return {"ok": True}

    @app.delete("/api/templates/{tid}")
    def delete_template(tid: str):
        ws.delete("templates", tid)
        return {"ok": True}

    # ------------------------------------------------------------------ applications

    def _render_application(d: Path, profile, plan: TailoringPlan, job: JobPosting, template_id: str,
                            strict: bool, step) -> dict:
        context, guard = apply_guard(profile, plan, allow_rephrase=not strict)
        step("Building your CV document…")
        name_part = (profile.personal.name or "CV").replace(" ", "_")
        docx = render_docx(context, ws.template_path(template_id), d / f"CV_{name_part}.docx")
        pdf_name, pages = "", 0
        if _find_soffice():
            step("Exporting PDF…")
            pdf_path = docx_to_pdf(docx)
            pdf_name = pdf_path.name
            pages = pdf_to_images(pdf_path, d, "page")
        (d / "plan.json").write_text(plan.model_dump_json(indent=2), encoding="utf-8")
        (d / "job.txt").write_text(job.text, encoding="utf-8")
        (d / "report.md").write_text(build_report(job, plan, context, guard), encoding="utf-8")
        matches = context["requirement_matches"]
        detail = {
            "analysis": plan.analysis.model_dump(),
            "headline": context["headline"],
            "summary": context["summary"],
            "requirements": matches,
            "warnings": guard.warnings,
            "cover_letter_hooks": plan.cover_letter_hooks,
            "experience": [{"title": e["title"], "company": e["company"], "bullets": e["bullets"]}
                           for e in context["experience"]],
        }
        (d / "detail.json").write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
        meta = {
            "id": d.name, "created": now(), "job_title": plan.analysis.job_title,
            "company": plan.analysis.company, "url": job.url or "", "template_id": template_id,
            "strict": strict, "docx": docx.name, "pdf": pdf_name, "pages": pages,
            "met": sum(m["status"] == "met" for m in matches),
            "partial": sum(m["status"] == "partial" for m in matches), "total": len(matches),
            "corrections": len(guard.warnings),
        }
        (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return meta

    def _generate(step, body: dict):
        profile = ws.load_profile()
        if profile is None:
            raise ProfileError("Your knowledge base is empty.")
        if body["job_text"].strip():
            job = JobPosting(text=body["job_text"].strip(), url=body["job_url"] or None)
        else:
            step("Reading the job posting…")
            job = fetch_job(body["job_url"].strip())
        step("Claude is analysing the job and tailoring your CV…")
        s = ws.settings()
        plan = tailor_mod.tailor(profile, job, model=s["model"], effort=s["effort"], client=client())
        aid, d = ws.new_application_dir(plan.analysis.company, plan.analysis.job_title)
        try:
            meta = _render_application(d, profile, plan, job, body["template_id"], body["strict"], step)
        except Exception:
            shutil.rmtree(d, ignore_errors=True)
            raise
        return {"application_id": meta["id"]}

    @app.post("/api/applications")
    def generate(body: GenerateIn):
        if not body.job_url.strip() and not body.job_text.strip():
            raise HTTPException(400, "Paste a job link or the job description.")
        require_profile()
        data = body.model_dump()
        data["template_id"] = body.template_id or ws.default_template_id()
        ws.template_path(data["template_id"])
        return {"task_id": tasks.submit("Generate CV", _generate, data)}

    @app.get("/api/applications")
    def list_applications():
        return ws.list_applications()

    @app.get("/api/applications/{aid}")
    def get_application(aid: str):
        d = ws.application_dir(aid)
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        detail = json.loads((d / "detail.json").read_text(encoding="utf-8"))
        return {"meta": meta, "detail": detail}

    @app.get("/api/applications/{aid}/pages/{n}.png")
    def application_page(aid: str, n: int):
        return FileResponse(ws.application_dir(aid) / f"page-{n}.png", media_type="image/png",
                            headers={"Cache-Control": "no-store"})

    @app.get("/api/applications/{aid}/files/{name}")
    def application_file(aid: str, name: str):
        d = ws.application_dir(aid)
        allowed = {p.name for p in d.iterdir() if p.suffix in {".docx", ".pdf", ".md"}}
        if name not in allowed:
            raise HTTPException(404, "Not found")
        media = {".pdf": "application/pdf", ".md": "text/markdown",
                 ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
        return FileResponse(d / name, media_type=media[Path(name).suffix], filename=name)


    @app.post("/api/applications/{aid}/rerender")
    def rerender(aid: str, body: RerenderIn):
        """Same content, different design - no API call."""
        d = ws.application_dir(aid)
        profile = require_profile()
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        plan = TailoringPlan.model_validate_json((d / "plan.json").read_text(encoding="utf-8"))
        job = JobPosting(text=(d / "job.txt").read_text(encoding="utf-8"), url=meta.get("url") or None)
        for p in d.iterdir():
            if p.suffix in {".docx", ".pdf"} or (p.suffix == ".png" and p.name.startswith("page-")):
                p.unlink()
        try:
            _render_application(d, profile, plan, job, body.template_id, meta.get("strict", False),
                                 lambda _m: None)
        except USER_ERRORS as exc:
            raise HTTPException(400, str(exc)) from exc
        return get_application(aid)

    @app.delete("/api/applications/{aid}")
    def delete_application(aid: str):
        ws.delete("applications", aid)
        return {"ok": True}

    # ------------------------------------------------------------------ frontend
    app.mount("/static", StaticFiles(directory=STATIC), name="static")

    @app.get("/", response_class=HTMLResponse)
    def index():
        return (STATIC / "index.html").read_text(encoding="utf-8")

    return app
