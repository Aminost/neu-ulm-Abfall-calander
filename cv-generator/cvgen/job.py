"""Fetch and clean a job posting from a URL (or a local text/HTML file)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from .models import JobPosting

MAX_CHARS = 40_000
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
}


class JobFetchError(RuntimeError):
    pass


def _html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe"]):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup
    text = root.get_text("\n")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _find_jsonld_jobposting(soup: BeautifulSoup) -> dict | None:
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                t = node.get("@type")
                if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
                    return node
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                stack.extend(node)
    return None


def parse_html(html: str, url: str | None = None) -> JobPosting:
    soup = BeautifulSoup(html, "html.parser")
    jp = _find_jsonld_jobposting(soup)
    page_text = _html_to_text(html)
    if jp:
        org = jp.get("hiringOrganization") or {}
        loc = jp.get("jobLocation") or {}
        if isinstance(loc, list):
            loc = loc[0] if loc else {}
        addr = (loc.get("address") or {}) if isinstance(loc, dict) else {}
        location = ", ".join(
            x for x in [addr.get("addressLocality"), addr.get("addressCountry")] if isinstance(x, str)
        ) or None
        desc = _html_to_text(jp.get("description", "")) if jp.get("description") else ""
        # Keep the rest of the page too: it often contains "about us" info.
        text = desc + ("\n\n--- Rest of page ---\n" + page_text if page_text else "")
        return JobPosting(
            url=url,
            title=jp.get("title"),
            company=org.get("name") if isinstance(org, dict) else None,
            location=location,
            text=text[:MAX_CHARS],
        )
    title = soup.title.get_text(strip=True) if soup.title else None
    return JobPosting(url=url, title=title, text=page_text[:MAX_CHARS])


def fetch_job(source: str, timeout: int = 30) -> JobPosting:
    """``source`` may be an http(s) URL, a .html file, or a .txt/.md file."""
    if re.match(r"^https?://", source):
        try:
            resp = requests.get(source, headers=HEADERS, timeout=timeout)
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise JobFetchError(
                f"Could not download {source}: {exc}\n"
                "Some sites (e.g. LinkedIn) block scripts. Copy the job text into a .txt "
                "file and pass it with --job instead."
            ) from exc
        job = parse_html(resp.text, url=source)
    else:
        path = Path(source)
        if not path.exists():
            raise JobFetchError(f"Job source not found: {source}")
        raw = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() in {".html", ".htm"}:
            job = parse_html(raw, url=None)
        else:
            job = JobPosting(text=raw[:MAX_CHARS])
    if len(job.text.strip()) < 200:
        raise JobFetchError(
            "The job page returned almost no text (it is probably rendered with JavaScript "
            "or behind a login). Copy the job description into a .txt file and pass that instead."
        )
    return job
