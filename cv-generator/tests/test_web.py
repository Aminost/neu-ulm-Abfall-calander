"""End-to-end tests of the web API with Claude mocked out."""
import io
import json
import time
import zipfile
from pathlib import Path

import pytest
import yaml
from docx import Document
from fastapi.testclient import TestClient

from cvgen import knowledge, tailor, template_convert
from cvgen.knowledge import ExtractionResult
from cvgen.models import Profile, TailoringPlan
from cvgen.template_convert import TemplateSpec
from cvgen.web.app import create_app
from cvgen.workspace import Workspace

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = yaml.safe_load((ROOT / "profile" / "profile.example.yaml").read_text())
PLAN = json.loads((ROOT / "examples" / "sample_plan.json").read_text())


def plain_cv_docx() -> bytes:
    d = Document()
    for t in ["Alex Example", "Software Engineer", "EXPERIENCE", "2021 – today", "Senior Engineer · ACME",
              "Built things", "Fixed things", "2018 – 2021", "Developer · Webstudio", "Made apps"]:
        d.add_paragraph(t)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    def fake_call(*, output_model, content, **kw):
        if output_model is ExtractionResult:
            return ExtractionResult(profile=Profile.model_validate(EXAMPLE), provenance=[], conflicts=[],
                                    questions=["What did you achieve at Webstudio?"], change_summary="Imported.")
        if output_model is TailoringPlan:
            return TailoringPlan.model_validate(PLAN)
        if output_model is TemplateSpec:
            P = lambda proto, runs=None, tag=None: {"proto": proto, "runs": runs or [], "tag": tag}
            return TemplateSpec.model_validate({"notes": "test", "ops": [
                {"kind": "set", "start": 1, "end": 1, "runs": ["{{ headline }}"]},
                {"kind": "replace", "start": 3, "end": 9, "new": [
                    P(3, tag="{%p for job in experience %}"), P(3, ["{{ job.dates }}"]),
                    P(4, ["{{ job.title }} · {{ job.company }}"]),
                    P(3, tag="{%p for b in job.bullets %}"), P(5, ["{{ b.text }}"]), P(3, tag="{%p endfor %}"),
                    P(3, tag="{%p endfor %}")]}]})
        raise AssertionError(output_model)

    for mod in (knowledge, tailor, template_convert):
        monkeypatch.setattr(mod, "structured_call", fake_call)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    ws = Workspace(tmp_path / "ws")
    ws.save_settings({"api_key": "sk-test"})
    return TestClient(create_app(ws))


def wait(c, task_id):
    for _ in range(200):
        t = c.get(f"/api/tasks/{task_id}").json()
        if t["status"] != "running":
            assert t["status"] == "done", t["error"]
            return t["result"]
        time.sleep(0.05)
    raise TimeoutError


def test_full_workflow(client):
    c = client
    assert c.get("/").status_code == 200
    st = c.get("/api/state").json()
    assert st["profile"] is None and st["templates"] == 1 and st["api_key"]

    # 1. sources: a Word CV and a LinkedIn-style ZIP export
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("Positions.csv", "Company Name,Title,Description,Started On,Finished On\n"
                                    "ACME,Senior Engineer,Built a platform,Apr 2021,\n")
    r = c.post("/api/sources", files=[("files", ("cv.docx", plain_cv_docx())),
                                      ("files", ("Basic_LinkedInDataExport.zip", zbuf.getvalue()))])
    added = r.json()["added"]
    assert [a["kind"] for a in added] == ["cv", "linkedin"]
    assert "Positions" in c.get(f"/api/sources/{added[1]['id']}/text").json()["text"]

    # 2. build knowledge -> proposal -> apply
    res = wait(c, c.post("/api/knowledge/build", json={"source_ids": [a["id"] for a in added]}).json()["task_id"])
    prop = c.get(f"/api/proposals/{res['proposal_id']}").json()
    assert prop["errors"] == [] and any(d["change"] == "added" for d in prop["diff"])
    assert c.post(f"/api/proposals/{res['proposal_id']}/apply").json()["ok"]
    assert c.get("/api/state").json()["profile"]["name"] == "Alex Example"

    # 3. template: plain CV gets converted
    res = wait(c, c.post("/api/templates", files={"file": ("my.docx", plain_cv_docx())}).json()["task_id"])
    tid = res["template_id"]
    assert any(t["id"] == tid and t["origin"] == "converted" for t in c.get("/api/templates").json())

    # 4. generate application
    res = wait(c, c.post("/api/applications", json={"job_text": "Senior Backend Engineer at NordFreight " * 20,
                                                    "template_id": tid}).json()["task_id"])
    app = c.get(f"/api/applications/{res['application_id']}").json()
    assert app["meta"]["company"] == "NordFreight SE"
    assert any("Terraform" in w for w in app["detail"]["warnings"])  # fact check reverted it
    f = c.get(f"/api/applications/{res['application_id']}/files/{app['meta']['docx']}")
    text = "\n".join(p.text for p in Document(io.BytesIO(f.content)).paragraphs)
    assert "Senior Software Engineer" in text and "ACME Logistics GmbH" in text and "{{" not in text

    # re-render with the built-in template, no LLM call
    r = c.post(f"/api/applications/{res['application_id']}/rerender", json={"template_id": "classic"})
    assert r.json()["meta"]["template_id"] == "classic"
    assert c.get(f"/api/applications/{res['application_id']}/files/../../settings.json").status_code == 404


def test_profile_yaml_validation(client):
    r = client.put("/api/profile", json={"yaml": "personal: {}\n"})
    assert r.status_code == 400
    good = yaml.safe_dump(EXAMPLE, allow_unicode=True)
    assert client.put("/api/profile", json={"yaml": good}).status_code == 200


def test_missing_api_key(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    c = TestClient(create_app(Workspace(tmp_path / "ws")))
    sid = c.post("/api/sources", files=[("files", ("cv.txt", b"Jane Doe, engineer at ACME since 2020."))]).json()["added"][0]["id"]
    tid = c.post("/api/knowledge/build", json={"source_ids": [sid]}).json()["task_id"]
    for _ in range(100):
        t = c.get(f"/api/tasks/{tid}").json()
        if t["status"] != "running":
            break
        time.sleep(0.05)
    assert t["status"] == "error" and "API key" in t["error"]


def test_settings_hide_key(client):
    s = client.get("/api/settings").json()
    assert "api_key" not in s and s["api_key_set"] and s["api_key_hint"] == "…test"


def test_fact_check_flags_invented_numbers():
    from cvgen.knowledge import fact_check
    from cvgen.sources import Source
    p = Profile.model_validate(EXAMPLE)
    src = Source(name="cv", kind="cv", text="Alex built a platform used by 40 customers")
    warnings = fact_check(None, p, [src])
    assert any("acme_k8s" in w for w in warnings)  # 12 services / 30% are not in the source
