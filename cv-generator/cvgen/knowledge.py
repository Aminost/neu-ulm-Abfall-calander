"""Build / update the knowledge base (profile) from uploaded sources.

Claude reads every source (CV, LinkedIn/XING export, certificates, notes ...) together with the
current profile and proposes an updated profile. Nothing is saved automatically: the result is a
*proposal* with a diff, conflicts, open questions and fact-check warnings that the user reviews.
"""

from __future__ import annotations

import base64
from typing import Optional

import yaml
from pydantic import BaseModel, Field

from .guard import _numbers
from .llm import structured_call
from .models import Profile
from .profile import lint_profile
from .sources import Source

SYSTEM_PROMPT = """\
You maintain a candidate's CV knowledge base: a structured, verified facts database used to
generate tailored CVs. You receive the CURRENT PROFILE (may be empty) and one or more SOURCES
(the candidate's CV, LinkedIn or XING profile/export, certificates, notes, other documents).

Return the complete UPDATED PROFILE that merges everything, plus provenance, conflicts and
questions.

Accuracy rules (most important):
- Only record facts that are stated in the sources or the current profile. Never invent or
  embellish: no new numbers, tools, results, titles or dates. Do not infer skill levels.
- Copy achievement bullets as close to verbatim as possible. You may split a long paragraph into
  several bullets and clean formatting, but keep every number and claim exactly as written.
- Translate new items into the profile's main language (settings.cv_language, or the language
  most of the current profile is written in) faithfully, without adding content.
- If sources disagree (dates, titles, grades...), keep the value from the CURRENT PROFILE when it
  has one (it was reviewed by the user), otherwise the most recent/most specific source, and
  report the disagreement in `conflicts`.

Merging rules:
- Keep every existing id, item and user setting unless the item is a true duplicate. Merge
  duplicates (same role at same company) into one entry and mention it in `conflicts`.
- New ids: short, lowercase, snake_case, unique (e.g. exp_bosch_tpo, tpo_rag, skill names).
- Experience and education: most recent first. Dates as "YYYY-MM" (or "YYYY"); empty end = ongoing.
- Link each bullet to the skill ids it demonstrates; add missing skills to `skills` (with a
  sensible category). `aliases` may only contain true synonyms / common abbreviations of the same
  skill (e.g. "K8s" for Kubernetes), never related-but-different skills.
- `headlines`: keep existing; you may add job titles the candidate actually held.
- `summaries`: keep existing; add one if none exists, written only from facts.
- Put facts that fit nowhere else (driving licence, work permit, availability) in `extra_facts`.
- Put volunteering / sports in `activities`, honours / scholarships / patents in `awards`.

`provenance`: for every experience, education, project, certification and publication id, list
which sources (by source name, or "current profile") support it.
`questions`: concrete things the candidate should add to make the knowledge base stronger
(e.g. "Position X at Y has no achievements - what did you deliver? Any numbers?"). Max 8.
"""


class Provenance(BaseModel):
    id: str
    sources: list[str]


class Conflict(BaseModel):
    topic: str
    details: str
    resolution: str


class ExtractionResult(BaseModel):
    profile: Profile
    provenance: list[Provenance]
    conflicts: list[Conflict]
    questions: list[str]
    change_summary: str = Field(description="2-4 sentences: what was added or changed.")


class DiffItem(BaseModel):
    section: str
    id: str
    label: str
    change: str  # added | removed | changed
    before: Optional[str] = None
    after: Optional[str] = None


class Proposal(BaseModel):
    result: ExtractionResult
    diff: list[DiffItem]
    warnings: list[str]
    errors: list[str]
    source_names: list[str]


def _profile_yaml(profile: Profile | None) -> str:
    if profile is None:
        return "(empty - this is the first import)"
    return yaml.safe_dump(profile.model_dump(exclude_none=True), sort_keys=False, allow_unicode=True)


def build_content(current: Profile | None, sources: list[Source]) -> list[dict]:
    blocks: list[dict] = [{"type": "text", "text": "<current_profile>\n" + _profile_yaml(current)
                           + "\n</current_profile>"}]
    for src in sources:
        header = f'<source name="{src.name}" kind="{src.kind}">'
        if src.pdf_bytes:
            blocks.append({"type": "text", "text": header + " (PDF document follows)"})
            blocks.append({
                "type": "document",
                "title": src.name,
                "source": {"type": "base64", "media_type": "application/pdf",
                           "data": base64.b64encode(src.pdf_bytes).decode()},
            })
            blocks.append({"type": "text", "text": "</source>"})
        else:
            blocks.append({"type": "text", "text": f"{header}\n{src.text}\n</source>"})
    blocks.append({"type": "text", "text": "Return the updated knowledge base."})
    return blocks


# --------------------------------------------------------------------------- #
# Diff + checks
# --------------------------------------------------------------------------- #
_SECTIONS = ["experience", "education", "skills", "languages", "projects", "certifications",
             "publications", "awards", "activities", "summaries"]


def _label(section: str, item: dict) -> str:
    if section == "experience":
        return f"{item.get('title')} · {item.get('company')}"
    if section == "education":
        return f"{item.get('degree')} · {item.get('institution')}"
    for key in ("name", "citation", "text"):
        if item.get(key):
            return str(item[key])[:90]
    return item.get("id", "")


def _flat(item: dict, skip=("bullets",)) -> str:
    return " · ".join(f"{k}: {v}" for k, v in item.items() if k not in skip and k != "id" and v not in (None, "", []))


def diff_profiles(old: Profile | None, new: Profile) -> list[DiffItem]:
    o = old.model_dump(exclude_none=True) if old else {}
    n = new.model_dump(exclude_none=True)
    out: list[DiffItem] = []
    for sec in _SECTIONS:
        old_items = {i["id"]: i for i in o.get(sec, [])}
        new_items = {i["id"]: i for i in n.get(sec, [])}
        for iid, item in new_items.items():
            if iid not in old_items:
                out.append(DiffItem(section=sec, id=iid, label=_label(sec, item), change="added",
                                    after=_flat(item)))
            elif _flat(item) != _flat(old_items[iid]):
                out.append(DiffItem(section=sec, id=iid, label=_label(sec, item), change="changed",
                                    before=_flat(old_items[iid]), after=_flat(item)))
            if sec == "experience":
                ob = {b["id"]: b["text"] for b in old_items.get(iid, {}).get("bullets", [])}
                for b in item.get("bullets", []):
                    if b["id"] not in ob:
                        out.append(DiffItem(section="bullets", id=b["id"], label=_label(sec, item),
                                            change="added", after=b["text"]))
                    elif ob[b["id"]] != b["text"]:
                        out.append(DiffItem(section="bullets", id=b["id"], label=_label(sec, item),
                                            change="changed", before=ob[b["id"]], after=b["text"]))
                nb = {b["id"] for b in item.get("bullets", [])}
                for bid, text in ob.items():
                    if bid not in nb:
                        out.append(DiffItem(section="bullets", id=bid, label=_label(sec, item),
                                            change="removed", before=text))
        for iid, item in old_items.items():
            if iid not in new_items:
                out.append(DiffItem(section=sec, id=iid, label=_label(sec, item), change="removed",
                                    before=_flat(item)))
    for key in ("personal", "headlines", "settings", "extra_facts", "interests"):
        if o.get(key) != n.get(key):
            out.append(DiffItem(section=key, id=key, label=key, change="changed" if o else "added",
                                before=str(o.get(key)) if o else None, after=str(n.get(key))))
    return out


def fact_check(old: Profile | None, new: Profile, sources: list[Source]) -> list[str]:
    """Every number in new/changed text must appear in a source or in the old profile."""
    corpus = " ".join(s.text for s in sources)
    if old:
        corpus += " " + old.model_dump_json()
    known = _numbers(corpus) | _numbers(corpus.replace(".", ""))  # 1.000 vs 1000
    warnings = []
    unreadable = [s.name for s in sources if s.pdf_bytes and len(s.text) < 200]
    if unreadable:
        warnings.append("Could not extract text from " + ", ".join(unreadable) + " (scanned PDF?) - "
                        "numbers from these files could not be double-checked.")
    old_texts = {b.text for e in old.experience for b in e.bullets} if old else set()
    for exp in new.experience:
        for b in exp.bullets:
            if b.text in old_texts:
                continue
            missing = _numbers(b.text) - known
            if missing:
                warnings.append(f"Bullet '{b.id}' contains numbers not found in any source: "
                                f"{sorted(missing)} - please verify.")
    return warnings


def build_knowledge(current: Profile | None, sources: list[Source], *, model: str | None = None,
                    effort: str = "high", client=None) -> Proposal:
    result = structured_call(
        system=SYSTEM_PROMPT,
        content=build_content(current, sources),
        output_model=ExtractionResult,
        model=model,
        effort=effort,
        max_tokens=64000,
        client=client,
    )
    return make_proposal(current, result, sources)


def make_proposal(current: Profile | None, result: ExtractionResult, sources: list[Source]) -> Proposal:
    if current is not None:
        # The user's reviewed settings always win.
        result.profile.settings = current.settings
        if current.personal.photo and not result.profile.personal.photo:
            result.profile.personal.photo = current.personal.photo
    return Proposal(
        result=result,
        diff=diff_profiles(current, result.profile),
        warnings=fact_check(current, result.profile, sources),
        errors=lint_profile(result.profile),
        source_names=[s.name for s in sources],
    )
