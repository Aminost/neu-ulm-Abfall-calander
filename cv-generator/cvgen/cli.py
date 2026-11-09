"""Command line interface.

    python -m cvgen generate --job https://company.com/jobs/123
    python -m cvgen generate --job job.txt --template templates/my_template.docx --pdf
    python -m cvgen check-profile
    python -m cvgen template-vars templates/my_template.docx
    python -m cvgen fetch-job https://company.com/jobs/123
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

from .guard import apply_guard
from .job import JobFetchError, fetch_job
from .models import TailoringPlan
from .profile import ProfileError, load_profile
from .render import RenderError, docx_to_pdf, render_docx, template_variables
from .report import build_report

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROFILE = ROOT / "profile" / "profile.yaml"
DEFAULT_TEMPLATE = ROOT / "templates" / "default.docx"
DEFAULT_OUT = ROOT / "output"


def _slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")
    return s[:60] or "cv"


def cmd_generate(args: argparse.Namespace) -> int:
    profile = load_profile(args.profile)
    job = fetch_job(args.job)
    print(f"• Job loaded: {job.title or '(untitled)'} — {len(job.text):,} characters")

    if args.plan:
        plan = TailoringPlan.model_validate_json(Path(args.plan).read_text(encoding="utf-8"))
        print(f"• Using saved plan {args.plan}")
    else:
        from .tailor import tailor  # imported lazily so other commands work without the SDK
        print(f"• Asking Claude ({args.model}) to analyse the job and tailor your CV…")
        plan = tailor(profile, job, model=args.model, effort=args.effort)

    context, guard = apply_guard(profile, plan, allow_rephrase=not args.strict)

    name_part = _slug(profile.personal.name)
    job_part = _slug(f"{plan.analysis.company}-{plan.analysis.job_title}")
    stem = f"{date.today():%Y-%m-%d}_{name_part}_{job_part}"
    out_dir = Path(args.out) / stem
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "plan.json").write_text(plan.model_dump_json(indent=2), encoding="utf-8")
    (out_dir / "job.txt").write_text(job.text, encoding="utf-8")
    docx = render_docx(context, args.template, out_dir / f"CV_{name_part}.docx")
    print(f"• Word document: {docx}")
    if args.pdf:
        pdf = docx_to_pdf(docx)
        print(f"• PDF:           {pdf}")
    report = build_report(job, plan, context, guard)
    (out_dir / "match_report.md").write_text(report, encoding="utf-8")
    print(f"• Match report:  {out_dir / 'match_report.md'}")
    if guard.warnings:
        print(f"⚠ Truth guard made {len(guard.warnings)} correction(s) — see the report.")
    return 0


def cmd_check_profile(args: argparse.Namespace) -> int:
    p = load_profile(args.profile)
    n_bullets = sum(len(e.bullets) for e in p.experience)
    print(f"Profile OK: {p.personal.name} — {len(p.experience)} roles, {n_bullets} bullets, "
          f"{len(p.skills)} skills, {len(p.projects)} projects, {len(p.languages)} languages.")
    return 0


def cmd_template_vars(args: argparse.Namespace) -> int:
    print("\n".join(sorted(template_variables(args.template))))
    return 0


def cmd_fetch_job(args: argparse.Namespace) -> int:
    job = fetch_job(args.job)
    print(json.dumps({"title": job.title, "company": job.company, "location": job.location},
                     ensure_ascii=False, indent=2))
    print("-" * 60)
    print(job.text[:3000])
    return 0


def cmd_web(args: argparse.Namespace) -> int:
    import threading
    import webbrowser

    import uvicorn

    from .web.app import create_app
    url = f"http://{args.host}:{args.port}"
    print(f"CV Studio running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="cvgen", description="Tailor your CV to a job posting.")
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE), help="path to profile.yaml")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="generate a tailored CV")
    g.add_argument("--job", required=True, help="job URL, or a .txt/.html file with the posting")
    g.add_argument("--template", default=str(DEFAULT_TEMPLATE), help="Word template (.docx) with tags")
    g.add_argument("--out", default=str(DEFAULT_OUT), help="output folder")
    g.add_argument("--pdf", action="store_true", help="also export a PDF")
    g.add_argument("--strict", action="store_true",
                   help="never rephrase: use your original bullets and summary word for word")
    g.add_argument("--model", default=None, help="Claude model id (default: claude-opus-5-5)")
    g.add_argument("--effort", default="high", choices=["low", "medium", "high", "xhigh", "max"])
    g.add_argument("--plan", help="re-render from a saved plan.json (no API call)")
    g.set_defaults(func=cmd_generate)

    c = sub.add_parser("check-profile", help="validate profile.yaml")
    c.set_defaults(func=cmd_check_profile)

    t = sub.add_parser("template-vars", help="list the tags used by a template")
    t.add_argument("template")
    t.set_defaults(func=cmd_template_vars)

    f = sub.add_parser("fetch-job", help="preview what the tool reads from a job URL")
    f.add_argument("job")
    f.set_defaults(func=cmd_fetch_job)

    w = sub.add_parser("web", help="start the CV Studio web app")
    w.add_argument("--host", default="127.0.0.1")
    w.add_argument("--port", type=int, default=8765)
    w.add_argument("--no-browser", action="store_true")
    w.set_defaults(func=cmd_web)

    args = ap.parse_args(argv)
    if getattr(args, "model", "x") is None:
        from .tailor import DEFAULT_MODEL
        args.model = DEFAULT_MODEL
    try:
        return args.func(args)
    except (ProfileError, JobFetchError, RenderError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # TailoringError and friends
        if exc.__class__.__name__ == "TailoringError":
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        raise


if __name__ == "__main__":
    sys.exit(main())
