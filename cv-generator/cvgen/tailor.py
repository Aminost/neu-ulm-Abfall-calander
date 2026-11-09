"""Ask Claude to build a tailoring plan: select, order and lightly rephrase facts."""

from __future__ import annotations

import json
import yaml

from .llm import DEFAULT_MODEL, LLMError, structured_call
from .models import JobPosting, Profile, TailoringPlan

__all__ = ["DEFAULT_MODEL", "TailoringError", "tailor"]

SYSTEM_PROMPT = """\
You are an expert career coach and CV writer. You tailor a candidate's CV to one job posting.

You receive:
1. PROFILE: the candidate's complete, verified facts database (YAML). Every item has an `id`.
2. JOB: the text of a job posting (may include extra page text such as "about us").

Your job is to return a tailoring plan that makes the candidate as strong as possible for this
job WITHOUT EVER STATING ANYTHING THAT IS NOT IN THE PROFILE.

Honesty rules - these override every other goal:
- Reference profile items only by their exact `id`. Never invent ids, employers, titles, dates,
  degrees, certifications, tools, numbers, team sizes, or results.
- When rephrasing a bullet you may: reorder clauses, change verbs, use the job ad's terminology for
  something the bullet *already* describes (e.g. "CI/CD" for "automated build and deployment
  pipelines"), and shorten. You may NOT add tools, metrics, scope, seniority or outcomes that the
  source bullet (and its listed skills) does not contain. If in doubt, keep the original text.
- `headline` must be copied verbatim from PROFILE.headlines - pick the one closest to the job.
- `summary` (2-4 sentences, no first person "I") may only combine facts from the profile; list
  every id it relies on in `summary_fact_ids` (experience, skill, education, summary ids...).
  Years of experience must be derivable from the experience dates.
- If the job asks for something the candidate does not have, mark it "missing" in
  `requirement_matches`. Do not paper over gaps.

Tailoring guidance:
- Follow the language instruction in <settings>. Keep German typography (e.g. „…“) if the profile
  uses it. Report the posting language in analysis.language_of_posting.
- Include every experience entry that matters for the timeline (avoid unexplained gaps), most
  recent first. Give relevant roles 3-6 bullets, less relevant roles 1-2. Order bullets by
  relevance to the job.
- Skill groups: 3-5 groups, most relevant first, only skill ids from the profile. Drop irrelevant
  skills.
- Projects/certifications/publications: include only those that help for this job (publications
  are valuable for research-oriented roles).
- Languages: include all languages unless clearly irrelevant.
- The CV should fit on 1-2 pages: be selective.
- Mirror the job ad's keywords where they are true, so applicant-tracking systems match the CV.
"""


def _profile_yaml(profile: Profile) -> str:
    data = profile.model_dump(exclude_none=True)
    data.get("personal", {}).pop("photo", None)
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)


def _settings_note(profile: Profile) -> str:
    st = profile.settings
    lang = (f"Write all CV text in language '{st.cv_language}'." if st.cv_language
            else "Write CV text in the language of the profile text (not of the job ad).")
    return f"{lang} Keep the summary under {st.summary_max_words} words."


def build_user_message(profile: Profile, job: JobPosting) -> str:
    meta = {k: v for k, v in {"url": job.url, "title": job.title, "company": job.company,
                              "location": job.location}.items() if v}
    return (
        "<profile>\n" + _profile_yaml(profile) + "</profile>\n\n"
        "<job_metadata>\n" + json.dumps(meta, ensure_ascii=False) + "\n</job_metadata>\n\n"
        "<job>\n" + job.text + "\n</job>\n\n"
        "<settings>" + _settings_note(profile) + "</settings>\n\n"
        "Return the tailoring plan."
    )


TailoringError = LLMError


def tailor(profile: Profile, job: JobPosting, model: str | None = None,
           effort: str = "high", client=None) -> TailoringPlan:
    return structured_call(
        system=SYSTEM_PROMPT,
        content=build_user_message(profile, job),
        output_model=TailoringPlan,
        model=model,
        effort=effort,
        max_tokens=32000,
        client=client,
    )
