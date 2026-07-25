"""Resolve user-supplied arxiv id / url / pdf url to a canonical PDF download url."""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

_ARXIV_ID_RE = re.compile(r"^(\d{4}\.\d{4,5})(v\d+)?$")


@dataclass
class ArxivRef:
    arxiv_id: str
    pdf_url: str


def _is_url(s: str) -> bool:
    return s.startswith("http://") or s.startswith("https://")


def _extract_id_from_url(url: str) -> str | None:
    """Pull an arxiv id out of an arxiv URL (abs/pdf)."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path
    if "arxiv.org" not in host:
        return None
    m = re.search(r"/(?:abs|pdf)/([^/]+?)(\.pdf)?$", path)
    if m:
        return m.group(1)
    return None


def resolve(ref: str | None, url: str | None, pdf_url: str | None) -> ArxivRef:
    if not ref and not url and not pdf_url:
        raise ValueError("need arxiv_id, arxiv_url or pdf_url")

    if pdf_url:
        aid = _extract_id_from_url(pdf_url) or _short_id()
        return ArxivRef(aid, pdf_url if pdf_url.endswith(".pdf") else pdf_url)

    if url:
        if _is_url(url):
            aid = _extract_id_from_url(url)
            if aid is None:
                raise ValueError(f"could not parse arxiv id from url: {url}")
            return ArxivRef(aid, f"https://arxiv.org/pdf/{aid}.pdf")

    if ref:  # bare id like 2401.12345
        ref = ref.strip()
        if not _ARXIV_ID_RE.match(ref):
            raise ValueError(f"not a recognized arxiv id: {ref}")
        return ArxivRef(ref, f"https://arxiv.org/pdf/{ref}.pdf")

    raise ValueError("unresolvable input")


def _short_id() -> str:
    import uuid as _u
    return _u.uuid4().hex[:8]


def fetch_title(arxiv_id: str, timeout: float = 10.0) -> str | None:
    """Best-effort title pull from the arxiv API."""
    try:
        r = httpx.get(
            f"http://export.arxiv.org/api/query?id_list={arxiv_id}",
            timeout=timeout, follow_redirects=True,
        )
        r.raise_for_status()
        body = r.text
        m = re.search(r"<entry>.*?<title>(.*?)</title>", body, re.DOTALL)
        if m:
            return m.group(1).strip().replace("\n", " ")
    except Exception:
        return None
    return None