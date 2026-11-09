"""Data models.

Two families of models live here:

* ``Profile`` -- your master "facts database". Everything the generator is
  allowed to say about you comes from here. Every item has a stable ``id`` so
  the tailoring step can *reference* facts instead of inventing them.
* ``TailoringPlan`` -- what the LLM returns. It only selects, orders and (lightly)
  rephrases items from the profile by id. Names, employers, titles, dates,
  degrees and so on are never taken from the LLM; they are copied from the
  profile when the CV is assembled.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Profile (your facts database)
# --------------------------------------------------------------------------- #
class Link(BaseModel):
    label: str
    url: str


class Personal(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    links: list[Link] = Field(default_factory=list)
    photo: Optional[str] = None  # optional path to a photo (common in DE/AT/CH CVs)
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None


class Bullet(BaseModel):
    id: str
    text: str
    skills: list[str] = Field(default_factory=list)  # skill ids this bullet demonstrates


class Experience(BaseModel):
    id: str
    title: str
    company: str
    location: Optional[str] = None
    start: str
    end: Optional[str] = None  # None / "present" -> current role
    employment_type: Optional[str] = None
    description: Optional[str] = None
    bullets: list[Bullet] = Field(default_factory=list)


class Education(BaseModel):
    id: str
    degree: str
    institution: str
    location: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    grade: Optional[str] = None
    details: list[str] = Field(default_factory=list)


class Skill(BaseModel):
    id: str
    name: str
    category: str = "Other"
    level: Optional[str] = None  # e.g. "Expert", "Advanced", "Working knowledge"
    years: Optional[float] = None
    aliases: list[str] = Field(default_factory=list)  # synonyms used in job ads


class Language(BaseModel):
    id: str
    name: str
    level: str  # e.g. "Native", "C1", "Business fluent"


class Project(BaseModel):
    id: str
    name: str
    role: Optional[str] = None
    date: Optional[str] = None
    url: Optional[str] = None
    description: str
    skills: list[str] = Field(default_factory=list)


class Certification(BaseModel):
    id: str
    name: str
    issuer: Optional[str] = None
    date: Optional[str] = None
    url: Optional[str] = None


class Summary(BaseModel):
    id: str
    text: str


class Publication(BaseModel):
    id: str
    citation: str
    year: Optional[str] = None
    url: Optional[str] = None


class Entry(BaseModel):
    """Generic short item (award, volunteering, sport ...)."""
    id: str
    text: str
    date: Optional[str] = None


class Settings(BaseModel):
    date_style: Literal["month_name", "numeric"] = Field(
        "month_name", description="'month_name' -> 'Oct 2025', 'numeric' -> '10/2025'")
    present_label: str = "Present"  # e.g. "heute"
    cv_language: Optional[str] = Field(
        None, description="Force the CV language (e.g. 'de'). Default: language of your profile text.")
    summary_max_words: int = 70


class Profile(BaseModel):
    personal: Personal
    settings: Settings = Field(default_factory=Settings)
    headlines: list[str] = Field(
        default_factory=list,
        description="Job titles / headlines you are comfortable using about yourself.",
    )
    summaries: list[Summary] = Field(
        default_factory=list,
        description="Pre-written summary paragraphs. The tailor may pick one or compose "
        "a new one strictly from facts in the profile.",
    )
    experience: list[Experience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    skills: list[Skill] = Field(default_factory=list)
    languages: list[Language] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    certifications: list[Certification] = Field(default_factory=list)
    publications: list[Publication] = Field(default_factory=list)
    awards: list[Entry] = Field(default_factory=list)
    activities: list[Entry] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    extra_facts: list[str] = Field(
        default_factory=list,
        description="Free-form true statements (soft skills, availability, work permit...).",
    )

    # ---- lookup helpers --------------------------------------------------- #
    def experience_by_id(self) -> dict[str, Experience]:
        return {e.id: e for e in self.experience}

    def bullet_by_id(self) -> dict[str, tuple[Experience, Bullet]]:
        return {b.id: (e, b) for e in self.experience for b in e.bullets}

    def skill_by_id(self) -> dict[str, Skill]:
        return {s.id: s for s in self.skills}

    def all_ids(self) -> set[str]:
        ids: set[str] = set()
        for coll in (
            self.experience,
            self.education,
            self.skills,
            self.languages,
            self.projects,
            self.certifications,
            self.summaries,
            self.publications,
            self.awards,
            self.activities,
        ):
            ids.update(item.id for item in coll)
        ids.update(self.bullet_by_id().keys())
        return ids


# --------------------------------------------------------------------------- #
# Job posting
# --------------------------------------------------------------------------- #
class JobPosting(BaseModel):
    url: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    text: str


# --------------------------------------------------------------------------- #
# Tailoring plan (LLM output -- references ids only)
# --------------------------------------------------------------------------- #
class JobAnalysis(BaseModel):
    job_title: str
    company: str
    company_summary: str = Field(description="What the company does, from the posting only.")
    seniority: str
    language_of_posting: str = Field(description="ISO code, e.g. 'en' or 'de'.")
    must_have: list[str]
    nice_to_have: list[str]
    keywords: list[str] = Field(description="ATS keywords / technologies named in the ad.")


class TailoredBullet(BaseModel):
    source_bullet_id: str
    text: str = Field(
        description="The bullet, optionally rephrased to mirror the job's wording. "
        "Must state nothing beyond the source bullet."
    )


class TailoredExperience(BaseModel):
    experience_id: str
    bullets: list[TailoredBullet]


class SkillGroup(BaseModel):
    category: str
    skill_ids: list[str]


class RequirementMatch(BaseModel):
    requirement: str
    status: Literal["met", "partial", "missing"]
    evidence_ids: list[str] = Field(description="Profile ids that prove the match.")
    note: str = ""


class TailoringPlan(BaseModel):
    analysis: JobAnalysis
    headline: str = Field(description="Must be one of profile.headlines verbatim.")
    summary: str = Field(description="2-4 sentences built only from profile facts.")
    summary_fact_ids: list[str] = Field(description="Ids of every fact the summary relies on.")
    experiences: list[TailoredExperience]
    skill_groups: list[SkillGroup]
    project_ids: list[str]
    education_ids: list[str]
    certification_ids: list[str]
    publication_ids: list[str] = Field(default_factory=list)
    language_ids: list[str]
    requirement_matches: list[RequirementMatch]
    cover_letter_hooks: list[str] = Field(
        default_factory=list,
        description="Optional: 2-3 true talking points for a cover letter / interview.",
    )
