"""Truth guard: deterministic checks that the tailored CV contains only facts from the profile.

The LLM never supplies employers, titles, dates, degrees etc. -- those are copied from the
profile. What the LLM *does* write (rephrased bullets and the summary) is checked here:

* every referenced id must exist (and bullets must belong to the referenced job);
* every number in a rephrased bullet must appear in the original bullet;
* technical-looking tokens (acronyms, CamelCase, C++, Node.js, CI/CD, ...) and any job-ad keyword
  used in a bullet must be supported by the original bullet, the skills linked to it (incl. their
  aliases) -- otherwise the bullet is reverted to its original wording;
* the summary may only use numbers / technical terms that appear in the profile; if it fails,
  the generator falls back to your own pre-written summary.

Anything that is dropped or reverted is reported as a warning so you can review it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from .models import Experience, Profile, TailoringPlan

_NUM_RE = re.compile(r"(?<![\w])\d+(?:[.,]\d+)?")
_TECH_RE = re.compile(
    r"""(?x)
    \b[A-Za-z][A-Za-z0-9]*(?:[+#]+|(?:[./-][A-Za-z0-9]+)+)   # C++, C#, Node.js, CI/CD, T-SQL
    | \b[A-Z]{2,}[a-z]*s?\b                                   # AWS, SQL, APIs, SAFe
    | \b[a-z]+[A-Z][A-Za-z]*\b                                # iOS, macOS, gRPC
    | \b[A-Z][a-z]+[A-Z][A-Za-z]*\b                           # PostgreSQL, JavaScript
    | \b[A-Za-z]+\d+[A-Za-z0-9]*\b                            # S3, EC2, Python3, K8s
    """
)
# Harmless tokens that look technical.
_TECH_ALLOW = {"e.g", "i.e", "etc", "vs", "CV", "OK", "USA", "UK", "EU", "B2B", "B2C"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


def _numbers(text: str) -> set[str]:
    return {n.replace(",", ".") for n in _NUM_RE.findall(text)}


def _tech_tokens(text: str) -> set[str]:
    toks = set()
    for m in _TECH_RE.finditer(text):
        tok = m.group(0).rstrip(".-/")
        if not tok or tok in _TECH_ALLOW:
            continue
        if re.fullmatch(r"[a-z]+(?:-[a-z]+)+", tok):
            continue  # ordinary hyphenated words ("shipment-tracking", "event-driven")
        toks.add(tok)
    return toks


def _supported(term: str, context: str) -> bool:
    t = _norm(term)
    if not t:
        return True
    if t in context:
        return True
    # tolerate simple plural / possessive changes ("APIs" vs "API")
    for suffix in ("s", "es", "'s"):
        if t.endswith(suffix) and t[: -len(suffix)] in context:
            return True
    return False


def _parse_ym(value: str | None) -> date | None:
    if not value or str(value).lower() in {"present", "now", "heute", "current", "today"}:
        return None
    m = re.match(r"(\d{4})(?:-(\d{1,2}))?", str(value))
    if not m:
        return None
    return date(int(m.group(1)), int(m.group(2) or 1), 1)


def total_years_experience(profile: Profile, today: date | None = None) -> float:
    today = today or date.today()
    months = 0
    for exp in profile.experience:
        start = _parse_ym(exp.start)
        if not start:
            continue
        end = _parse_ym(exp.end) or today
        months += max(0, (end.year - start.year) * 12 + end.month - start.month)
    return months / 12


@dataclass
class GuardReport:
    warnings: list[str] = field(default_factory=list)
    reverted_bullets: list[str] = field(default_factory=list)
    summary_fallback: bool = False

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def _bullet_context(profile: Profile, exp: Experience, bullet_id: str) -> str:
    skills = profile.skill_by_id()
    _, bullet = profile.bullet_by_id()[bullet_id]
    parts = [bullet.text, exp.title, exp.company, exp.description or ""]
    for sid in bullet.skills:
        s = skills.get(sid)
        if s:
            parts.append(s.name)
            parts.extend(s.aliases)
    return _norm(" | ".join(parts))


def _profile_corpus(profile: Profile) -> str:
    return _norm(profile.model_dump_json())


def check_bullet(original: str, rewritten: str, context: str, job_keywords: list[str]) -> list[str]:
    """Return a list of problems with ``rewritten`` (empty list == OK)."""
    problems = []
    extra_nums = _numbers(rewritten) - _numbers(original)
    if extra_nums:
        problems.append(f"new numbers {sorted(extra_nums)}")
    for tok in sorted(_tech_tokens(rewritten)):
        if not _supported(tok, context):
            problems.append(f"unsupported term '{tok}'")
    low = _norm(rewritten)
    for kw in job_keywords:
        k = _norm(kw)
        if len(k) >= 2 and re.search(r"(?<!\w)" + re.escape(k) + r"(?!\w)", low) and not _supported(k, context):
            problems.append(f"job keyword '{kw}' not backed by the source bullet")
    if len(rewritten) > max(60, 1.6 * len(original)):
        problems.append("rewrite is much longer than the original")
    return sorted(set(problems))


def apply_guard(profile: Profile, plan: TailoringPlan, allow_rephrase: bool = True,
                today: date | None = None) -> tuple[dict, GuardReport]:
    """Validate the plan and build the (safe) template context."""
    rep = GuardReport()
    exps = profile.experience_by_id()
    bullets = profile.bullet_by_id()
    skills = profile.skill_by_id()
    corpus = _profile_corpus(profile)
    job_keywords = list(dict.fromkeys(plan.analysis.keywords + plan.analysis.must_have
                                      + plan.analysis.nice_to_have))
    # Keep only short keyword-like requirements (long sentences are not useful for matching).
    job_keywords = [k for k in job_keywords if len(k.split()) <= 3]

    # ---- headline ---------------------------------------------------------- #
    headline = plan.headline.strip()
    if profile.headlines and headline not in profile.headlines:
        rep.warn(f"Headline '{headline}' is not in your profile headlines; using '{profile.headlines[0]}'.")
        headline = profile.headlines[0]
    elif not profile.headlines:
        headline = profile.experience[0].title if profile.experience else ""

    # ---- experiences --------------------------------------------------------- #
    chosen: dict[str, list[dict]] = {}
    for te in plan.experiences:
        exp = exps.get(te.experience_id)
        if not exp:
            rep.warn(f"Dropped unknown experience id '{te.experience_id}'.")
            continue
        out = []
        seen = set()
        for tb in te.bullets:
            pair = bullets.get(tb.source_bullet_id)
            if not pair or pair[0].id != exp.id:
                rep.warn(f"Dropped bullet '{tb.source_bullet_id}' (unknown or not part of {exp.id}).")
                continue
            if tb.source_bullet_id in seen:
                continue
            seen.add(tb.source_bullet_id)
            original = pair[1].text
            text = tb.text.strip() if allow_rephrase else original
            if text != original:
                problems = check_bullet(original, text, _bullet_context(profile, exp, tb.source_bullet_id),
                                        job_keywords)
                if problems:
                    rep.reverted_bullets.append(tb.source_bullet_id)
                    rep.warn(f"Reverted bullet '{tb.source_bullet_id}' to your original wording: "
                             + "; ".join(problems))
                    text = original
            out.append({"id": tb.source_bullet_id, "text": text})
        chosen[exp.id] = out

    experience_ctx = []
    for exp in profile.experience:  # keep your profile's (chronological) order
        if exp.id not in chosen:
            rep.warn(f"Experience '{exp.id}' ({exp.title} @ {exp.company}) was left out - check for timeline gaps.")
            continue
        experience_ctx.append({
            "id": exp.id,
            "title": exp.title,
            "company": exp.company,
            "location": exp.location or "",
            "start": exp.start,
            "end": exp.end or "",
            "dates": format_range(exp.start, exp.end),
            "employment_type": exp.employment_type or "",
            "description": exp.description or "",
            "bullets": chosen[exp.id],
        })

    # ---- skills -------------------------------------------------------------- #
    skill_groups = []
    used = set()
    for g in plan.skill_groups:
        items = []
        for sid in g.skill_ids:
            s = skills.get(sid)
            if not s:
                rep.warn(f"Dropped unknown skill id '{sid}'.")
                continue
            if sid in used:
                continue
            used.add(sid)
            items.append({"name": s.name, "level": s.level or "", "years": s.years})
        if items:
            skill_groups.append({"category": g.category, "items": items,
                                 "joined": ", ".join(i["name"] for i in items)})

    # ---- simple id lists ----------------------------------------------------- #
    def pick(ids: list[str], coll: list, label: str, default_all: bool = False) -> list:
        by_id = {x.id: x for x in coll}
        out = []
        for i in ids:
            if i in by_id:
                if by_id[i] not in out:
                    out.append(by_id[i])
            else:
                rep.warn(f"Dropped unknown {label} id '{i}'.")
        if not out and default_all:
            out = list(coll)
        return out

    education = pick(plan.education_ids, profile.education, "education", default_all=True)
    languages = pick(plan.language_ids, profile.languages, "language", default_all=True)
    projects = pick(plan.project_ids, profile.projects, "project")
    certs = pick(plan.certification_ids, profile.certifications, "certification")

    # ---- summary -------------------------------------------------------------- #
    summary = plan.summary.strip()
    problems = []
    years = total_years_experience(profile, today)
    for n in _numbers(summary):
        if n in corpus:
            continue
        try:
            if float(n) <= years + 0.5:
                continue  # "5+ years" style statements derivable from dates
        except ValueError:
            pass
        problems.append(f"number '{n}' not found in profile")
    for tok in _tech_tokens(summary):
        if not _supported(tok, corpus):
            problems.append(f"term '{tok}' not found in profile")
    for kw in job_keywords:
        k = _norm(kw)
        if len(k) >= 2 and re.search(r"(?<!\w)" + re.escape(k) + r"(?!\w)", _norm(summary)) \
                and not _supported(k, corpus):
            problems.append(f"job keyword '{kw}' not found in profile")
    bad_ids = [i for i in plan.summary_fact_ids if i not in profile.all_ids()]
    if bad_ids:
        problems.append(f"cites unknown ids {bad_ids}")
    if problems or not allow_rephrase:
        if problems:
            rep.warn("Summary replaced by your own pre-written summary: " + "; ".join(sorted(set(problems))))
        rep.summary_fallback = True
        summary = profile.summaries[0].text if profile.summaries else ""

    # ---- requirement matches ------------------------------------------------- #
    known = profile.all_ids()
    matches = []
    for m in plan.requirement_matches:
        ev = [i for i in m.evidence_ids if i in known]
        status = m.status
        if status != "missing" and not ev:
            status = "missing"  # a claim of a match must have evidence
        matches.append({"requirement": m.requirement, "status": status, "evidence": ev, "note": m.note})

    p = profile.personal
    context = {
        "name": p.name,
        "headline": headline,
        "email": p.email or "",
        "phone": p.phone or "",
        "location": p.location or "",
        "links": [l.model_dump() for l in p.links],
        "date_of_birth": p.date_of_birth or "",
        "nationality": p.nationality or "",
        "photo_path": p.photo or "",
        "summary": summary,
        "experience": experience_ctx,
        "skill_groups": skill_groups,
        "education": [{
            "degree": e.degree, "institution": e.institution, "location": e.location or "",
            "dates": format_range(e.start, e.end) if (e.start or e.end) else "",
            "grade": e.grade or "", "details": e.details,
        } for e in education],
        "languages": [{"name": l.name, "level": l.level} for l in languages],
        "languages_joined": ", ".join(f"{l.name} ({l.level})" for l in languages),
        "projects": [{
            "name": pr.name, "role": pr.role or "", "date": pr.date or "", "url": pr.url or "",
            "description": pr.description,
        } for pr in projects],
        "certifications": [{
            "name": c.name, "issuer": c.issuer or "", "date": c.date or "", "url": c.url or "",
        } for c in certs],
        "interests": profile.interests,
        "interests_joined": ", ".join(profile.interests),
        "job": {
            "title": plan.analysis.job_title,
            "company": plan.analysis.company,
        },
        "requirement_matches": matches,
    }
    return context, rep


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def format_date(value: str | None) -> str:
    if not value:
        return "Present"
    if str(value).lower() in {"present", "now", "current", "today"}:
        return "Present"
    m = re.fullmatch(r"(\d{4})-(\d{1,2})(?:-\d{1,2})?", str(value))
    if m:
        return f"{_MONTHS[int(m.group(2)) - 1]} {m.group(1)}"
    return str(value)


def format_range(start: str | None, end: str | None) -> str:
    return f"{format_date(start)} – {format_date(end)}" if start else format_date(end)
