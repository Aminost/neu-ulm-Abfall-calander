"""Human-readable match report written next to the generated CV."""

from __future__ import annotations

from .guard import GuardReport
from .models import JobPosting, TailoringPlan

_ICON = {"met": "✅", "partial": "🟡", "missing": "❌"}


def build_report(job: JobPosting, plan: TailoringPlan, context: dict, guard: GuardReport) -> str:
    a = plan.analysis
    matches = context["requirement_matches"]
    met = sum(m["status"] == "met" for m in matches)
    partial = sum(m["status"] == "partial" for m in matches)
    lines = [
        f"# Match report: {a.job_title} @ {a.company}",
        "",
        f"- Source: {job.url or 'local file'}",
        f"- Seniority: {a.seniority} · Posting language: {a.language_of_posting}",
        f"- Requirements met: **{met}/{len(matches)}** (partial: {partial})",
        "",
        "## About the company (from the posting)",
        a.company_summary,
        "",
        "## Requirements",
        "| | Requirement | Evidence in your profile | Note |",
        "|---|---|---|---|",
    ]
    for m in matches:
        ev = ", ".join(f"`{e}`" for e in m["evidence"]) or "—"
        note = m["note"].replace("|", "/")
        lines.append(f"| {_ICON[m['status']]} | {m['requirement'].replace('|', '/')} | {ev} | {note} |")

    missing = [m["requirement"] for m in matches if m["status"] == "missing"]
    if missing:
        lines += ["", "## Gaps (not claimed in the CV)",
                  "These were **not** added to your CV because your profile has no evidence for them. "
                  "If you actually have this experience, add it to `profile.yaml` and regenerate.", ""]
        lines += [f"- {m}" for m in missing]

    lines += ["", "## ATS keywords from the ad", ", ".join(a.keywords) or "—"]

    if plan.cover_letter_hooks:
        lines += ["", "## Talking points for cover letter / interview"]
        lines += [f"- {h}" for h in plan.cover_letter_hooks]

    lines += ["", "## Truth guard"]
    if guard.warnings:
        lines.append("The following automatic corrections were made — please review:")
        lines += [f"- {w}" for w in guard.warnings]
    else:
        lines.append("All tailored content passed the fact checks.")
    lines += ["", "> Always proofread the final CV before sending it."]
    return "\n".join(lines) + "\n"
