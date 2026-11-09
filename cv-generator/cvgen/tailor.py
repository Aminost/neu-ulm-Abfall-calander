"""Ask Claude to build a tailoring plan: select, order and lightly rephrase facts."""

from __future__ import annotations

import json
import os

import anthropic
import yaml

from .models import JobPosting, Profile, TailoringPlan

DEFAULT_MODEL = os.environ.get("CVGEN_MODEL", "claude-opus-5-5")

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
- Write in the language of the job posting if the profile text is in that language; otherwise keep
  the profile's language. (Report the posting language in analysis.language_of_posting.)
- Include every experience entry that matters for the timeline (avoid unexplained gaps), most
  recent first. Give relevant roles 3-6 bullets, less relevant roles 1-2. Order bullets by
  relevance to the job.
- Skill groups: 3-5 groups, most relevant first, only skill ids from the profile. Drop irrelevant
  skills.
- Projects/certifications: include only those that help for this job.
- Languages: include all languages unless clearly irrelevant.
- The CV should fit on 1-2 pages: be selective.
- Mirror the job ad's keywords where they are true, so applicant-tracking systems match the CV.
"""


def _profile_yaml(profile: Profile) -> str:
    data = profile.model_dump(exclude_none=True)
    data.get("personal", {}).pop("photo", None)
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)


def build_user_message(profile: Profile, job: JobPosting) -> str:
    meta = {k: v for k, v in {"url": job.url, "title": job.title, "company": job.company,
                              "location": job.location}.items() if v}
    return (
        "<profile>\n" + _profile_yaml(profile) + "</profile>\n\n"
        "<job_metadata>\n" + json.dumps(meta, ensure_ascii=False) + "\n</job_metadata>\n\n"
        "<job>\n" + job.text + "\n</job>\n\n"
        "Return the tailoring plan."
    )


class TailoringError(RuntimeError):
    pass


def tailor(profile: Profile, job: JobPosting, model: str = DEFAULT_MODEL,
           effort: str = "high", client: anthropic.Anthropic | None = None) -> TailoringPlan:
    client = client or anthropic.Anthropic()
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            messages=[{"role": "user", "content": build_user_message(profile, job)}],
            output_format=TailoringPlan,
            # Server-side fallback: if a request is ever declined by a safety
            # classifier, Anthropic re-runs it on a recommended fallback model.
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
    except anthropic.AuthenticationError as exc:
        raise TailoringError("Anthropic API key missing or invalid. Set ANTHROPIC_API_KEY.") from exc
    except anthropic.RateLimitError as exc:
        raise TailoringError("Rate limited by the Anthropic API - try again in a minute.") from exc
    except anthropic.APIStatusError as exc:
        raise TailoringError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise TailoringError(f"Could not reach the Anthropic API: {exc}") from exc

    if response.stop_reason == "refusal":
        raise TailoringError("The model declined this request.")
    if response.stop_reason == "max_tokens":
        raise TailoringError("The model ran out of output tokens; try a smaller profile.")
    if response.parsed_output is None:
        raise TailoringError("The model did not return a valid tailoring plan.")
    return response.parsed_output
