"""Turn an ordinary Word CV into a docxtpl template while keeping its design.

1. ``describe_docx`` lists every paragraph (document order, incl. table cells) with its style and
   text runs.
2. Claude returns a ``TemplateSpec``: which paragraphs become placeholders ("set") and which
   ranges of repeated entries collapse into one tagged prototype ("replace").
3. ``apply_spec`` performs the edits on the XML: paragraphs are *cloned* from the original, so
   fonts, colours, spacing, bullets and table layout are preserved.
4. ``validate_template`` renders the result with the user's profile to prove it works.
"""

from __future__ import annotations

import copy
import io
import json
from typing import Optional

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pydantic import BaseModel, Field

from .llm import structured_call

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


class TemplateError(RuntimeError):
    pass


# --------------------------------------------------------------------------- #
# Spec (LLM output)
# --------------------------------------------------------------------------- #
class NewParagraph(BaseModel):
    proto: int = Field(description="Index of the original paragraph to clone (formatting source).")
    tag: Optional[str] = Field(None, description="For control paragraphs: the full '{%p ... %}' tag.")
    runs: list[str] = Field(default_factory=list,
                            description="Text for the prototype's text runs, in order (ignored if tag).")


class Operation(BaseModel):
    kind: str = Field(description="'set' (replace the runs of one paragraph) or 'replace' "
                                  "(replace paragraphs start..end inclusive by `new`)")
    start: int
    end: int = Field(description="Same as start for 'set'.")
    runs: list[str] = Field(default_factory=list, description="For 'set'.")
    new: list[NewParagraph] = Field(default_factory=list, description="For 'replace'.")


class TemplateSpec(BaseModel):
    ops: list[Operation]
    notes: str = Field(description="Short explanation of the mapping for the user.")


# --------------------------------------------------------------------------- #
# Describe
# --------------------------------------------------------------------------- #
def _paragraphs(doc) -> list:
    return [el for el in doc.element.body.iter(qn("w:p"))]


def _text_runs(p) -> list:
    return [r for r in p.findall(qn("w:r")) if r.find(qn("w:t")) is not None]


def _run_text(r) -> str:
    return "".join(t.text or "" for t in r.findall(qn("w:t")))


def _container_id(p) -> str:
    tc = None
    for anc in p.iterancestors():
        if anc.tag == qn("w:tc"):
            tc = anc
            break
    if tc is None:
        return "body"
    tbl = next(a for a in tc.iterancestors() if a.tag == qn("w:tbl"))
    tr = tc.getparent()
    return (f"table{id(tbl) % 10000}/row{list(tbl.findall(qn('w:tr'))).index(tr)}"
            f"/cell{list(tr.findall(qn('w:tc'))).index(tc)}")


def describe_docx(data: bytes) -> list[dict]:
    doc = Document(io.BytesIO(data))
    out = []
    for i, p in enumerate(_paragraphs(doc)):
        style = p.find(qn("w:pPr"))
        style_el = style.find(qn("w:pStyle")) if style is not None else None
        runs = [_run_text(r).replace(" ", "") for r in _text_runs(p)]
        out.append({
            "i": i,
            "container": _container_id(p),
            "style": style_el.get(qn("w:val")) if style_el is not None else "Normal",
            "numbered": bool(style is not None and style.find(qn("w:numPr")) is not None),
            "has_image": bool(p.findall(".//" + qn("w:drawing"))),
            "runs": runs,
        })
    return out


def is_template(data: bytes) -> bool:
    text = " ".join(" ".join(p["runs"]) for p in describe_docx(data))
    return "{{" in text or "{%" in text


# --------------------------------------------------------------------------- #
# Apply
# --------------------------------------------------------------------------- #
def _set_runs(p, texts: list[str]):
    runs = _text_runs(p)
    if not runs and texts:
        r = OxmlElement("w:r")
        t = OxmlElement("w:t")
        r.append(t)
        p.append(r)
        runs = [r]
    for r, text in zip(runs, texts):
        ts = r.findall(qn("w:t"))
        ts[0].text = text
        ts[0].set(XML_SPACE, "preserve")
        for extra in ts[1:]:
            r.remove(extra)
    for r in runs[len(texts):]:
        p.remove(r)
    # remove images from cloned text paragraphs (keeps photo only where it was)
    return p


def _clone(p, texts: list[str]):
    q = copy.deepcopy(p)
    for d in q.findall(".//" + qn("w:drawing")):
        run = d.getparent()
        if run is not None and run.getparent() is not None:
            run.getparent().remove(run)
    return _set_runs(q, texts)


def _tag_paragraph(proto, tag: str):
    q = copy.deepcopy(proto)
    for r in list(q.findall(qn("w:r"))):
        q.remove(r)
    for el in list(q):
        if el.tag in (qn("w:hyperlink"), qn("w:ins"), qn("w:smartTag")):
            q.remove(el)
    return _set_runs(q, [tag])


def fix_letter_spacing(doc):
    """Hair-space letter spacing ("P R O F I L") breaks lines in some renderers; use real spacing."""
    for t in doc.element.body.iter(qn("w:t")):
        if t.text and " " in t.text:
            t.text = t.text.replace(" ", "")
            r = t.getparent()
            rPr = r.find(qn("w:rPr"))
            if rPr is None:
                rPr = OxmlElement("w:rPr")
                r.insert(0, rPr)
            if rPr.find(qn("w:spacing")) is None:
                sp = OxmlElement("w:spacing")
                sp.set(qn("w:val"), "40")
                rPr.append(sp)


def apply_spec(data: bytes, spec: TemplateSpec) -> bytes:
    doc = Document(io.BytesIO(data))
    paras = _paragraphs(doc)
    n = len(paras)

    def check(i, what):
        if not 0 <= i < n:
            raise TemplateError(f"{what}: paragraph index {i} out of range (0..{n - 1}).")

    # Validate and build all new elements first (protos must still be intact).
    covered: set[int] = set()
    planned = []
    for op in spec.ops:
        check(op.start, op.kind)
        check(op.end, op.kind)
        if op.end < op.start:
            raise TemplateError(f"Operation {op.kind} {op.start}..{op.end} is reversed.")
        rng = set(range(op.start, op.end + 1))
        if rng & covered:
            raise TemplateError(f"Operations overlap at paragraphs {sorted(rng & covered)}.")
        covered |= rng
        parent = paras[op.start].getparent()
        if any(paras[i].getparent() is not parent for i in rng):
            raise TemplateError(f"Paragraphs {op.start}..{op.end} are not in the same container.")
        if op.kind == "set":
            planned.append(("set", op, None))
        elif op.kind == "replace":
            new_els = []
            for np_ in op.new:
                check(np_.proto, "prototype")
                proto = paras[np_.proto]
                new_els.append(_tag_paragraph(proto, np_.tag) if np_.tag else _clone(proto, np_.runs))
            planned.append(("replace", op, new_els))
        else:
            raise TemplateError(f"Unknown operation '{op.kind}'.")

    for kind, op, new_els in planned:
        if kind == "set":
            _set_runs(paras[op.start], op.runs)
        else:
            anchor = paras[op.start]
            for el in new_els:
                anchor.addprevious(el)
            for i in range(op.start, op.end + 1):
                paras[i].getparent().remove(paras[i])
    fix_letter_spacing(doc)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# LLM step
# --------------------------------------------------------------------------- #
VARIABLES_DOC = """\
Top-level strings: name, headline, email, phone, location, date_of_birth, nationality, summary,
  languages_joined, interests_joined, photo (inline image - only if a photo placeholder is wanted)
links: list of {label, url}
experience: list of job with job.title, job.company, job.location, job.dates (formatted range),
  job.employment_type, job.description (e.g. thesis title line), job.bullets (list of b with b.text)
education: list of e with e.degree, e.institution, e.location, e.dates, e.grade, e.details (list of str)
skill_groups: list of g with g.category, g.joined ("A, B, C"), g.items (list of {name, level})
skills_by_level: list of lv with lv.level, lv.joined   (skills that have a level, e.g. "Sehr gut")
skill_groups_unleveled: like skill_groups but only skills without level: g.category, g.joined_unleveled
languages: list of {name, level}
projects: list of pr with pr.name, pr.role, pr.date, pr.url, pr.description
certifications: list of c with c.name, c.issuer, c.date, c.url
publications: list of pub with pub.citation
awards, activities: list of x with x.text
job.title, job.company: the job applied for
"""

SYSTEM_PROMPT = f"""\
You convert a person's existing Word CV into a docxtpl (Jinja2) template, so the same design can
be refilled with tailored content. You get the document as a numbered list of paragraphs
(document order, including table cells) with their style and text runs.

Available template variables:
{VARIABLES_DOC}
Produce operations:
- kind "set": replace the text runs of a single paragraph (start=end) with `runs` (one string per
  original run, in order; fewer strings drop the remaining runs). Use for single values, e.g.
  runs ["{{{{ headline }}}}"] or ["{{{{ summary }}}}"].
- kind "replace": replace paragraphs start..end (inclusive, same container) with `new`
  paragraphs. Each new paragraph clones the formatting of original paragraph `proto`.
  Control paragraphs use `tag` with a complete docxtpl paragraph tag, e.g. "{{%p for job in
  experience %}}", "{{%p endfor %}}", "{{%p if publications %}}", "{{%p endif %}}".
  Use this to collapse a section's repeated entries into ONE prototype entry inside a loop.

Guidelines:
- Keep static what is the same for every application: photo, name, contact/personal info, and
  section headings. Keep the person's design (it is cloned automatically).
- Make dynamic: headline/subtitle under the name (if it is a job title), profile/summary text,
  experience entries, education entries, skill lists, and - if present - projects,
  certifications, publications, languages.
- For each repeated entry, choose a prototype paragraph for every line type (date line, title
  line, optional description line, bullet) from the FIRST entry, and map its runs so bold/colour
  runs stay on the right parts, e.g. runs ["{{{{ job.title }}}}", "  ·  {{{{ job.company }}}}{{% if
  job.location %}}, {{{{ job.location }}}}{{% endif %}}"].
- Optional lines: wrap in "{{%p if job.description %}}" ... "{{%p endif %}}".
- Nested loops: bullets inside jobs ("{{%p for b in job.bullets %}}" ... "{{%p endfor %}}").
- Section headings that may become empty (projects, publications, certifications) go inside
  the if-block together with the loop.
- Every opened {{%p for/if %}} must be closed. Ranges must not overlap. Indices refer to the
  ORIGINAL numbering.
- If skills in the CV are grouped by proficiency ("Very good: ...", "Sehr gut: ..."), use
  skills_by_level for them and skill_groups_unleveled for the other skill lists.
"""


def convert_with_llm(data: bytes, *, model: str | None = None, client=None) -> tuple[bytes, TemplateSpec]:
    desc = describe_docx(data)
    if is_template(data):
        raise TemplateError("This document already contains template tags - upload it as a template.")
    spec = structured_call(
        system=SYSTEM_PROMPT,
        content="<paragraphs>\n" + json.dumps(desc, ensure_ascii=False, indent=0) + "\n</paragraphs>\n"
                "Return the conversion operations.",
        output_model=TemplateSpec,
        model=model,
        effort="high",
        max_tokens=32000,
        client=client,
    )
    return apply_spec(data, spec), spec
