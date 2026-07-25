"""LlamaIndex-based PDF -> markdown parsing for /ingest."""
from __future__ import annotations

import tempfile
from pathlib import Path

import httpx


def _download_pdf(url: str) -> bytes:
    r = httpx.get(url, timeout=60.0, follow_redirects=True)
    r.raise_for_status()
    return r.content


def pdf_bytes_to_markdown(pdf_bytes: bytes, filename: str = "paper.pdf") -> str:
    """Write the PDF to a temp dir, run LlamaIndex SimpleDirectoryReader, concat docs.

    LlamaIndex's SimpleDirectoryReader returns Document objects; we join them,
    preferring already-markdown content where available.
    """
    from llama_index.core import SimpleDirectoryReader  # local import: lazy + heavy

    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / filename
        p.write_bytes(pdf_bytes)
        reader = SimpleDirectoryReader(input_dir=tmp, required_exts=[".pdf"])
        docs = reader.load_data()
        parts: list[str] = []
        for d in docs:
            text = d.text or ""
            parts.append(text)
        return "\n\n".join(parts).strip()


def parse(arxiv_ref) -> str:
    pdf = _download_pdf(arxiv_ref.pdf_url)
    return pdf_bytes_to_markdown(pdf)