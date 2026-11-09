"""Load and sanity-check the profile (your facts database)."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import yaml
from pydantic import ValidationError

from .models import Profile


class ProfileError(RuntimeError):
    pass


def load_profile(path: str | Path) -> Profile:
    path = Path(path)
    if not path.exists():
        raise ProfileError(
            f"Profile not found: {path}. Copy profile/profile.example.yaml to profile/profile.yaml "
            "and fill in your own details."
        )
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        profile = Profile.model_validate(data)
    except (yaml.YAMLError, ValidationError) as exc:
        raise ProfileError(f"Invalid profile {path}:\n{exc}") from exc
    problems = lint_profile(profile)
    if problems:
        raise ProfileError("Profile problems:\n- " + "\n- ".join(problems))
    if profile.personal.photo:
        photo = Path(profile.personal.photo)
        if not photo.is_absolute():
            profile.personal.photo = str((path.parent / photo).resolve())
    return profile


def lint_profile(profile: Profile) -> list[str]:
    problems = []
    ids = [e.id for e in profile.experience] + [b.id for e in profile.experience for b in e.bullets]
    for coll in (profile.education, profile.skills, profile.languages, profile.projects,
                 profile.certifications, profile.summaries, profile.publications,
                 profile.awards, profile.activities):
        ids += [x.id for x in coll]
    dupes = [i for i, n in Counter(ids).items() if n > 1]
    if dupes:
        problems.append(f"duplicate ids: {dupes}")
    skill_ids = {s.id for s in profile.skills}
    for e in profile.experience:
        for b in e.bullets:
            for s in b.skills:
                if s not in skill_ids:
                    problems.append(f"bullet '{b.id}' references unknown skill '{s}'")
    for p in profile.projects:
        for s in p.skills:
            if s not in skill_ids:
                problems.append(f"project '{p.id}' references unknown skill '{s}'")
    if not profile.headlines:
        problems.append("add at least one entry under `headlines`")
    return problems
