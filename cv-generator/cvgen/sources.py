"""Read knowledge sources (CV, LinkedIn/XING exports, other documents) into plain text."""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from docx import Document

SUPPORTED = {".pdf", ".docx", ".zip", ".txt", ".md", ".html", ".htm", ".csv", ".yaml", ".yml", ".json"}
MAX_SOURCE_CHARS = 120_000


class SourceError(RuntimeError):
    pass


@dataclass
class Source:
    name: str
    kind: str          # cv, linkedin, xing, other
    text: str
    pdf_bytes: bytes | None = None  # sent to Claude as a document (keeps layout)
    meta: dict = field(default_factory=dict)


def guess_kind(filename: str, text: str) -> str:
    name = filename.lower()
    head = text[:4000].lower()
    for kind in ("linkedin", "xing"):
        if kind in name:
            return kind
    if re.search(r"lebenslauf|curriculum|resume|résumé|\bcv\b", name):
        return "cv"
    # LinkedIn's "Save to PDF" export has these section titles
    if "linkedin.com/in/" in head and re.search(r"top skills|top-kenntnisse|summary\n|zusammenfassung", head):
        return "linkedin"
    if "xing.com/profile" in head and "xing" in head[:600]:
        return "xing"
    return "cv" if re.search(r"lebenslauf|curriculum vitae|resume|berufserfahrung|work experience", head) else "other"


def _docx_text(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts: list[str] = []
    for el in doc.element.body.iter():  # document order, including table cells
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = "".join(t.text or "" for t in el.iter() if t.tag.endswith("}t"))
            if text.strip():
                parts.append(text.replace(" ", ""))
    return "\n".join(parts)


def _pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover
        return ""
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


_LINKEDIN_FILES = [
    "Profile.csv", "Positions.csv", "Education.csv", "Skills.csv", "Languages.csv",
    "Certifications.csv", "Projects.csv", "Publications.csv", "Honors.csv", "Courses.csv",
    "Volunteering.csv", "Patents.csv", "Organizations.csv", "Recommendations_Received.csv",
]


def _csv_to_text(name: str, raw: str) -> str:
    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows:
        return ""
    lines = [f"## {name.removesuffix('.csv')}"]
    for row in rows:
        items = [f"{k}: {v.strip()}" for k, v in row.items() if k and v and v.strip()]
        if items:
            lines.append("- " + " | ".join(items))
    return "\n".join(lines)


def _zip_text(data: bytes) -> tuple[str, str]:
    """LinkedIn / XING data exports are ZIPs of CSV files."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = {Path(n).name: n for n in z.namelist() if not n.endswith("/")}
        chosen = [n for n in _LINKEDIN_FILES if n in names]
        if not chosen:  # unknown export: take every csv/txt
            chosen = [n for n in names if n.lower().endswith((".csv", ".txt", ".md"))]
        parts = []
        for n in chosen:
            raw = z.read(names[n]).decode("utf-8-sig", errors="replace")
            parts.append(_csv_to_text(n, raw) if n.lower().endswith(".csv") else raw)
    kind = "linkedin" if any(n in names for n in ("Positions.csv", "Profile.csv")) else "other"
    return "\n\n".join(p for p in parts if p), kind


def _html_text(raw: str) -> str:
    from .job import _html_to_text
    return _html_to_text(raw)


def read_source(filename: str, data: bytes, kind: str | None = None) -> Source:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise SourceError(f"Unsupported file type '{ext}'. Use PDF, Word, ZIP, TXT, MD or HTML.")
    pdf_bytes = None
    detected = None
    if ext == ".pdf":
        text = _pdf_text(data)
        pdf_bytes = data
    elif ext == ".docx":
        text = _docx_text(data)
    elif ext == ".zip":
        text, detected = _zip_text(data)
    elif ext in {".html", ".htm"}:
        text = _html_text(data.decode("utf-8", errors="replace"))
    elif ext == ".csv":
        text = _csv_to_text(filename, data.decode("utf-8-sig", errors="replace"))
    else:
        text = data.decode("utf-8", errors="replace")
    text = text.strip()
    if not text and not pdf_bytes:
        raise SourceError(f"No text found in {filename}.")
    if len(text) > MAX_SOURCE_CHARS:
        raise SourceError(f"{filename} is very large ({len(text):,} characters). Please upload "
                          "a shorter document or split it.")
    return Source(name=filename, kind=kind or detected or guess_kind(filename, text), text=text,
                  pdf_bytes=pdf_bytes)


def read_url(url: str, kind: str | None = None) -> Source:
    import requests

    from .job import HEADERS
    if "linkedin.com" in url or "xing.com" in url:
        raise SourceError(
            "LinkedIn and XING profiles require a login and cannot be read automatically. "
            "Use 'Save to PDF' on your profile (or the data export) and upload the file instead."
        )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise SourceError(f"Could not download {url}: {exc}") from exc
    text = _html_text(resp.text)
    if len(text) < 100:
        raise SourceError("The page returned almost no text (probably needs JavaScript or a login).")
    return Source(name=url, kind=kind or "other", text=text[:MAX_SOURCE_CHARS])
