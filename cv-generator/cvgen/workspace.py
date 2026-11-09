"""On-disk workspace for the web app (everything personal lives here, git-ignored).

workspace/
  profile.yaml                  knowledge base
  history/profile-<ts>.yaml     backups before every change
  sources/<id>/                 uploaded documents (+ meta.json, text.txt)
  proposals/<id>.json           knowledge-base update proposals awaiting review
  templates/<id>/               template.docx, preview.pdf, meta.json
  applications/<id>/            cv.docx, cv.pdf, plan.json, job.txt, context.json, meta.json
  settings.json                 model, API key (optional), default template
"""

from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

import yaml

from .models import Profile

PKG_ROOT = Path(__file__).resolve().parent.parent
BUILTIN_TEMPLATES = {
    "classic": ("Classic – one column", PKG_ROOT / "templates" / "default.docx"),
}


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def new_id(prefix: str = "") -> str:
    return prefix + datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")[:60] or "cv"


class Workspace:
    def __init__(self, root: str | Path | None = None):
        self.root = Path(root or os.environ.get("CVGEN_HOME") or PKG_ROOT / "workspace")
        for sub in ("history", "sources", "proposals", "templates", "applications"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self._seed()

    # ------------------------------------------------------------------ seed
    def _seed(self):
        legacy = PKG_ROOT / "profile" / "profile.yaml"
        if not self.profile_path.exists() and legacy.exists() and self.root == PKG_ROOT / "workspace":
            shutil.copy(legacy, self.profile_path)
        for tid, (name, path) in BUILTIN_TEMPLATES.items():
            d = self.root / "templates" / tid
            if not (d / "template.docx").exists() and path.exists():
                d.mkdir(parents=True, exist_ok=True)
                shutil.copy(path, d / "template.docx")
                self._write_json(d / "meta.json", {"id": tid, "name": name, "origin": "built-in",
                                                   "created": now(), "notes": ""})
        legacy_tpl = PKG_ROOT / "templates" / "my_template.docx"
        d = self.root / "templates" / "my-cv"
        if legacy_tpl.exists() and not d.exists() and self.root == PKG_ROOT / "workspace":
            d.mkdir(parents=True)
            shutil.copy(legacy_tpl, d / "template.docx")
            self._write_json(d / "meta.json", {"id": "my-cv", "name": "My CV design", "origin": "uploaded",
                                               "created": now(), "notes": ""})

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _write_json(path: Path, data) -> None:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _read_json(path: Path, default=None):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return default

    def _safe_dir(self, kind: str, item_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", item_id):
            raise FileNotFoundError(item_id)
        d = self.root / kind / item_id
        if not d.exists():
            raise FileNotFoundError(item_id)
        return d

    # ------------------------------------------------------------------ settings
    @property
    def settings_path(self) -> Path:
        return self.root / "settings.json"

    def settings(self) -> dict:
        s = {"model": "claude-opus-5-5", "effort": "high", "default_template": "", "api_key": ""}
        s.update(self._read_json(self.settings_path, {}) or {})
        return s

    def save_settings(self, data: dict) -> dict:
        s = self.settings()
        s.update({k: v for k, v in data.items() if k in s})
        self._write_json(self.settings_path, s)
        try:
            os.chmod(self.settings_path, 0o600)
        except OSError:
            pass
        return s

    def api_key(self) -> str | None:
        return os.environ.get("ANTHROPIC_API_KEY") or self.settings().get("api_key") or None

    # ------------------------------------------------------------------ profile
    @property
    def profile_path(self) -> Path:
        return self.root / "profile.yaml"

    def has_profile(self) -> bool:
        return self.profile_path.exists()

    def load_profile(self) -> Profile | None:
        if not self.has_profile():
            return None
        from .profile import load_profile
        return load_profile(self.profile_path)

    def profile_yaml(self) -> str:
        return self.profile_path.read_text(encoding="utf-8") if self.has_profile() else ""

    def save_profile_yaml(self, text: str) -> Profile:
        from .profile import ProfileError, lint_profile
        try:
            profile = Profile.model_validate(yaml.safe_load(text) or {})
        except Exception as exc:  # noqa: BLE001
            raise ProfileError(str(exc)) from exc
        problems = lint_profile(profile)
        if problems:
            raise ProfileError("; ".join(problems))
        self._backup()
        self.profile_path.write_text(text, encoding="utf-8")
        return profile

    def save_profile(self, profile: Profile) -> None:
        text = yaml.safe_dump(profile.model_dump(exclude_none=True), sort_keys=False, allow_unicode=True,
                              width=110)
        self._backup()
        self.profile_path.write_text(text, encoding="utf-8")

    def _backup(self):
        if self.profile_path.exists():
            shutil.copy(self.profile_path, self.root / "history" / f"profile-{new_id()}.yaml")

    # ------------------------------------------------------------------ sources
    def add_source(self, filename: str, data: bytes, kind: str | None = None) -> dict:
        from .sources import read_source
        src = read_source(filename, data, kind)
        sid = new_id("src-")
        d = self.root / "sources" / sid
        d.mkdir(parents=True)
        safe_name = re.sub(r"[^\w.\- ]+", "_", Path(filename).name)
        (d / safe_name).write_bytes(data)
        (d / "text.txt").write_text(src.text, encoding="utf-8")
        meta = {"id": sid, "name": Path(filename).name, "file": safe_name, "kind": src.kind,
                "chars": len(src.text), "added": now(), "is_pdf": src.pdf_bytes is not None}
        self._write_json(d / "meta.json", meta)
        return meta

    def add_url_source(self, url: str, kind: str | None = None) -> dict:
        from .sources import read_url
        src = read_url(url, kind)
        sid = new_id("src-")
        d = self.root / "sources" / sid
        d.mkdir(parents=True)
        (d / "text.txt").write_text(src.text, encoding="utf-8")
        meta = {"id": sid, "name": url, "file": "", "kind": src.kind, "chars": len(src.text),
                "added": now(), "is_pdf": False, "url": url}
        self._write_json(d / "meta.json", meta)
        return meta

    def list_sources(self) -> list[dict]:
        out = [self._read_json(d / "meta.json") for d in (self.root / "sources").iterdir() if d.is_dir()]
        return sorted([m for m in out if m], key=lambda m: m["added"], reverse=True)

    def load_source(self, sid: str):
        from .sources import Source
        d = self._safe_dir("sources", sid)
        meta = self._read_json(d / "meta.json")
        pdf = (d / meta["file"]).read_bytes() if meta.get("is_pdf") else None
        return Source(name=meta["name"], kind=meta["kind"],
                      text=(d / "text.txt").read_text(encoding="utf-8"), pdf_bytes=pdf)

    def set_source_kind(self, sid: str, kind: str) -> dict:
        d = self._safe_dir("sources", sid)
        meta = self._read_json(d / "meta.json")
        meta["kind"] = kind
        self._write_json(d / "meta.json", meta)
        return meta

    def source_text(self, sid: str) -> str:
        return (self._safe_dir("sources", sid) / "text.txt").read_text(encoding="utf-8")

    def delete(self, kind: str, item_id: str) -> None:
        shutil.rmtree(self._safe_dir(kind, item_id))

    # ------------------------------------------------------------------ proposals
    def save_proposal(self, proposal) -> str:
        pid = new_id("prop-")
        (self.root / "proposals" / f"{pid}.json").write_text(proposal.model_dump_json(), encoding="utf-8")
        return pid

    def load_proposal(self, pid: str):
        from .knowledge import Proposal
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", pid):
            raise FileNotFoundError(pid)
        return Proposal.model_validate_json((self.root / "proposals" / f"{pid}.json").read_text(encoding="utf-8"))

    def delete_proposal(self, pid: str) -> None:
        p = self.root / "proposals" / f"{pid}.json"
        if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", pid) and p.exists():
            p.unlink()

    # ------------------------------------------------------------------ templates
    def list_templates(self) -> list[dict]:
        out = []
        for d in (self.root / "templates").iterdir():
            meta = self._read_json(d / "meta.json")
            if meta and (d / "template.docx").exists():
                meta["has_preview"] = (d / "preview.pdf").exists()
                meta["pages"] = len(list(d.glob("preview-*.png")))
                out.append(meta)
        default = self.settings().get("default_template")
        for m in out:
            m["default"] = m["id"] == default
        return sorted(out, key=lambda m: (m["origin"] == "built-in", m["created"]), reverse=False)

    def add_template(self, name: str, data: bytes, origin: str, notes: str = "") -> dict:
        tid = new_id("tpl-")
        d = self.root / "templates" / tid
        d.mkdir(parents=True)
        (d / "template.docx").write_bytes(data)
        meta = {"id": tid, "name": name, "origin": origin, "created": now(), "notes": notes}
        self._write_json(d / "meta.json", meta)
        return meta

    def template_path(self, tid: str) -> Path:
        return self._safe_dir("templates", tid) / "template.docx"

    def default_template_id(self) -> str:
        ids = [t["id"] for t in self.list_templates()]
        d = self.settings().get("default_template")
        if d in ids:
            return d
        for t in self.list_templates():
            if t["origin"] != "built-in":
                return t["id"]
        return ids[0] if ids else ""

    # ------------------------------------------------------------------ applications
    def new_application_dir(self, company: str, title: str) -> tuple[str, Path]:
        aid = datetime.now().strftime("%Y%m%d-%H%M%S-") + slug(f"{company}-{title}")[:40]
        d = self.root / "applications" / aid
        d.mkdir(parents=True)
        return aid, d

    def list_applications(self) -> list[dict]:
        out = [self._read_json(d / "meta.json") for d in (self.root / "applications").iterdir() if d.is_dir()]
        return sorted([m for m in out if m], key=lambda m: m["created"], reverse=True)

    def application_dir(self, aid: str) -> Path:
        return self._safe_dir("applications", aid)
