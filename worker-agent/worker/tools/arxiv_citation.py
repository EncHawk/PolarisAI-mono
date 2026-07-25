"""arxiv lookup tool: given an arxiv id (or title), fetch abstract + pdf metadata.

Uses the public arxiv Atom API. We do NOT download full PDFs for citations --
that's what the READ pipeline itself does for the main paper. We keep the
RESEARCH agent cheap: abstracts are plenty to answer "what does this citation
claim and how is it used".
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import httpx

ATOM_NS = "{http://www.w3.org/2005/Atom}"


def search_id(arxiv_id: str, timeout: float = 10.0) -> dict | None:
    """Look up a single arxiv id via the arxiv API and return {id,title,abstract}."""
    arxiv_id = _normalize_id(arxiv_id)
    url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}"
    try:
        r = httpx.get(url, timeout=timeout, follow_redirects=True)
        r.raise_for_status()
    except Exception:
        return None
    return _parse_first(r.text, arxiv_id)


def search_title(title: str, max_results: int = 1, timeout: float = 10.0) -> dict | None:
    """Best-effort: find an arxiv entry by title text search."""
    q = " ".join(title.split())
    url = f"http://export.arxiv.org/api/query?search_query=ti:{_quote(q)}&max_results={max_results}"
    try:
        r = httpx.get(url, timeout=timeout, follow_redirects=True)
        r.raise_for_status()
    except Exception:
        return None
    return _parse_first(r.text, None)


def _normalize_id(s: str) -> str:
    s = s.strip()
    m = re.match(r"^(\d{4}\.\d{4,5})(v\d+)?$", s)
    if m:
        return m.group(1)
    # take last path segment if a url slipped in
    m = re.search(r"(\d{4}\.\d{4,5})(v\d+)?", s)
    return m.group(1) if m else s


def _quote(s: str) -> str:
    return "%20".join(s.split())


def _parse_first(atom: str, requested_id: str | None) -> dict | None:
    try:
        root = ET.fromstring(atom)
    except ET.ParseError:
        return None
    entry = root.find(f"{ATOM_NS}entry")
    if entry is None:
        return None
    title = (entry.findtext(f"{ATOM_NS}title") or "").strip().replace("\n", " ")
    summary = (entry.findtext(f"{ATOM_NS}summary") or "").strip().replace("\n", " ")
    id_el = (entry.findtext(f"{ATOM_NS}id") or "").strip()
    aid = requested_id or ""
    if not aid:
        m = re.search(r"abs/([^/]+?)$", id_el)
        if m:
            aid = m.group(1)
    return {"arxiv_id": aid, "title": title, "abstract": summary}