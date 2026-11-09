import json
from pathlib import Path

import pytest

from cvgen.guard import apply_guard, check_bullet
from cvgen.job import parse_html
from cvgen.models import TailoringPlan
from cvgen.profile import load_profile
from cvgen.render import render_docx

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "profile" / "profile.example.yaml"
PLAN = ROOT / "examples" / "sample_plan.json"


@pytest.fixture
def profile():
    return load_profile(PROFILE)


def plan(**overrides):
    data = json.loads(PLAN.read_text())
    data.update(overrides)
    return TailoringPlan.model_validate(data)


def test_example_profile_is_valid(profile):
    assert profile.personal.name == "Alex Example"


def test_invented_keyword_is_reverted(profile):
    ctx, rep = apply_guard(profile, plan())
    acme = next(e for e in ctx["experience"] if e["id"] == "exp_acme")
    k8s = next(b for b in acme["bullets"] if b["id"] == "acme_k8s")
    assert "Terraform" not in k8s["text"]
    assert "acme_k8s" in rep.reverted_bullets


def test_alias_rewording_is_allowed(profile):
    ctx, rep = apply_guard(profile, plan())
    acme = next(e for e in ctx["experience"] if e["id"] == "exp_acme")
    ci = next(b for b in acme["bullets"] if b["id"] == "acme_ci")
    assert ci["text"].startswith("Introduced CI/CD pipelines")
    assert "acme_ci" not in rep.reverted_bullets


@pytest.mark.parametrize("rewrite", [
    "Migrated 15 services from virtual machines to Kubernetes on AWS, reducing cost by 30%.",  # new number
    "Migrated 12 services to Kubernetes and GCP, reducing infrastructure cost by 30%.",       # new tech
    "Migrated 12 services to Kubernetes on AWS using Terraform, cutting cost by 30%.",        # job keyword
])
def test_fabrications_are_detected(profile, rewrite):
    exp, bullet = profile.bullet_by_id()["acme_k8s"]
    from cvgen.guard import _bullet_context
    problems = check_bullet(bullet.text, rewrite, _bullet_context(profile, exp, "acme_k8s"), ["Terraform"])
    assert problems


def test_unknown_ids_and_wrong_owner_are_dropped(profile):
    p = plan()
    p.experiences[0].bullets.append(p.experiences[1].bullets[0].model_copy(update={}))  # web bullet under acme
    p.skill_groups[0].skill_ids.append("golang")
    p.certification_ids.append("cert_fake")
    ctx, rep = apply_guard(profile, p)
    acme = next(e for e in ctx["experience"] if e["id"] == "exp_acme")
    assert all(b["id"].startswith("acme_") for b in acme["bullets"])
    assert all(i["name"] != "golang" for g in ctx["skill_groups"] for i in g["items"])
    assert [c["name"] for c in ctx["certifications"]] == ["AWS Certified Developer – Associate"]
    assert len(rep.warnings) >= 3


def test_headline_must_come_from_profile(profile):
    ctx, rep = apply_guard(profile, plan(headline="Principal Architect"))
    assert ctx["headline"] == "Senior Software Engineer"


def test_summary_with_invented_fact_falls_back(profile):
    ctx, rep = apply_guard(profile, plan(summary="Engineer with 12 years of Terraform and Go experience."))
    assert rep.summary_fallback
    assert ctx["summary"] == profile.summaries[0].text


def test_match_without_evidence_becomes_missing(profile):
    data = json.loads(PLAN.read_text())
    data["requirement_matches"] = [{"requirement": "Go", "status": "met", "evidence_ids": ["made_up"], "note": ""}]
    ctx, _ = apply_guard(profile, TailoringPlan.model_validate(data))
    assert ctx["requirement_matches"][0]["status"] == "missing"


def test_strict_mode_uses_original_text(profile):
    ctx, rep = apply_guard(profile, plan(), allow_rephrase=False)
    originals = {b: pair[1].text for b, pair in profile.bullet_by_id().items()}
    for e in ctx["experience"]:
        for b in e["bullets"]:
            assert b["text"] == originals[b["id"]]
    assert ctx["summary"] == profile.summaries[0].text


def test_jsonld_job_parsing():
    html = """<html><head><title>x</title><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"JobPosting","title":"Data Engineer",
     "hiringOrganization":{"@type":"Organization","name":"Foo GmbH"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"Berlin","addressCountry":"DE"}},
     "description":"<p>We need <b>Spark</b>.</p>"}</script></head><body><main>About Foo</main></body></html>"""
    job = parse_html(html, url="https://example.com")
    assert job.title == "Data Engineer" and job.company == "Foo GmbH"
    assert job.location == "Berlin, DE" and "Spark" in job.text


def test_render_docx(profile, tmp_path):
    from docx import Document
    ctx, _ = apply_guard(profile, plan())
    out = render_docx(ctx, ROOT / "templates" / "default.docx", tmp_path / "cv.docx")
    text = "\n".join(p.text for p in Document(out).paragraphs)
    assert "Alex Example" in text and "ACME Logistics GmbH" in text
    assert "{{" not in text and "{%" not in text
