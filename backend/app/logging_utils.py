"""Structured console logging for Polaris backend.

Every request and every significant step is logged with millisecond timing
so production issues can be traced without leaking internals to the client.
"""
from __future__ import annotations

import logging
import sys
import time
import traceback
from contextlib import contextmanager
from typing import Any

# Configure root handler if nothing is set up yet (e.g. uvicorn hasn't run)
if not logging.getLogger().handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)

POLARIS_LOGGER = logging.getLogger("polaris")


def _fmt_ms(t0: float) -> str:
    return f"{(time.perf_counter() - t0) * 1000:.1f}ms"


def log_step(label: str, detail: str = "", *, logger: logging.Logger | None = None) -> None:
    """Fire-and-forget single-line step log."""
    (logger or POLARIS_LOGGER).info("[STEP] %s%s", label, f" | {detail}" if detail else "")


@contextmanager
def log_timer(label: str, detail: str = "", *, logger: logging.Logger | None = None):
    """Context manager that logs entry and exit with elapsed time."""
    log = logger or POLARIS_LOGGER
    extra = f" | {detail}" if detail else ""
    log.info("[BEGIN] %s%s", label, extra)
    t0 = time.perf_counter()
    try:
        yield
        log.info("[END]   %s | %s%s", label, _fmt_ms(t0), extra)
    except Exception as exc:
        log.error("[FAIL]  %s | %s%s | %s", label, _fmt_ms(t0), extra, exc, exc_info=True)
        raise


def log_request_start(request: Any, user_id: str | None = None) -> float:
    """Log the start of an HTTP request; returns the perf_counter start time."""
    t0 = time.perf_counter()
    path = getattr(request, "url", None)
    path_str = str(path) if path else "unknown"
    client = getattr(request, "client", None)
    host = client.host if client else "unknown"
    user = f" user={user_id}" if user_id else ""
    POLARIS_LOGGER.info("[REQ]  %s %s | client=%s%s", request.method, path_str, host, user)
    return t0


def log_request_end(request: Any, status: int, t0: float, *, error: Exception | None = None) -> None:
    """Log the end of an HTTP request with duration and optional error."""
    path = getattr(request, "url", None)
    path_str = str(path) if path else "unknown"
    elapsed = _fmt_ms(t0)
    if error:
        tb = traceback.format_exception(type(error), error, error.__traceback__)
        POLARIS_LOGGER.error(
            "[RESP] %s %s | status=%s | %s\n%s",
            request.method,
            path_str,
            status,
            elapsed,
            "".join(tb),
        )
    else:
        POLARIS_LOGGER.info("[RESP] %s %s | status=%s | %s", request.method, path_str, status, elapsed)
