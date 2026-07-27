"""API-key auth + USD credit accounting.

The token is a single UUID stored on users.api_key (rotated on /auth/exchange).
It is presented via `Authorization: Bearer …`, `X-API-Key`, the `polaris_session`
cookie (legacy), or `?api_key=` for SSE. The NextJS frontend now owns the
httpOnly cookie holding the api_key and forwards it as a Bearer header.

Credits are a USD numeric balance on users.credits. LLM token usage is recorded
in usage_events and deducted atomically here (see record_usage / deduct_credits).
"""
from __future__ import annotations

import time
import uuid
from decimal import Decimal

from fastapi import Cookie, Header, HTTPException, Query, status

from app.logging_utils import log_step
from app.store.supabase import get_supabase

API_KEY_HEADER = "X-API-Key"
BEARER_HEADER = "Authorization"
SESSION_COOKIE = "polaris_session"

# Pricing: $0.05 per 100k tokens (input + output).
PRICE_PER_100K_TOKENS = Decimal("0.05")
TOKENS_PER_UNIT = Decimal(100_000)


def generate_api_key() -> str:
    return str(uuid.uuid4())


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


def verify_api_key(api_key: str | None) -> dict:
    if not api_key:
        log_step("auth.token.missing", "no bearer/x-api-key/cookie presented")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing api key")
    t0 = time.perf_counter()
    db = get_supabase()
    rows = (
        db.table("users")
        .select(
            "id,email,name,username,github,x,credits,api_key,"
            "subscription_id,subscription_tier,renews_at"
        )
        .eq("api_key", api_key)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        log_step("auth.token.invalid", f"key_prefix={api_key[:8]}… | {(time.perf_counter()-t0)*1000:.1f}ms")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
    u = rows[0]
    log_step("auth.token.ok", f"user={u['id']} | email={u['email']} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return {
        "sub": u["id"],
        "email": u["email"],
        "name": u.get("name"),
        "username": u.get("username"),
        "github": u.get("github"),
        "x": u.get("x"),
        "credits": Decimal(str(u.get("credits") or 0)),
        "subscription_tier": u.get("subscription_tier"),
        "renews_at": u.get("renews_at"),
    }


def current_user(
    authorization: str | None = Header(default=None, alias=BEARER_HEADER),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict:
    token = _extract_bearer(authorization) or x_api_key or session_cookie
    return verify_api_key(token)


async def current_user_optional(
    authorization: str | None = Header(default=None, alias=BEARER_HEADER),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict | None:
    token = _extract_bearer(authorization) or x_api_key or session_cookie
    if not token:
        return None
    try:
        return verify_api_key(token)
    except HTTPException:
        return None


def current_user_sse(
    api_key: str | None = Query(default=None, alias="api_key"),
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    authorization: str | None = Header(default=None, alias=BEARER_HEADER),
) -> dict:
    token = _extract_bearer(authorization) or x_api_key or api_key
    return verify_api_key(token)


def require_positive_balance(user: dict) -> None:
    """Gate job start: balance must be > 0. No deduction here — usage records deduct."""
    credits = user.get("credits") or Decimal(0)
    if credits <= 0:
        log_step("credits.balance.too_low", f"user={user.get('sub')} | balance={credits}")
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "insufficient credit balance: subscribe or top up to start a run",
        )
    log_step("credits.balance.ok", f"user={user.get('sub')} | balance={credits}")


def cost_for_tokens(input_tokens: int, output_tokens: int) -> Decimal:
    """$0.05 per 100k tokens (input + output), rounded to 6 decimals."""
    total = Decimal(input_tokens) + Decimal(output_tokens)
    if total <= 0:
        return Decimal(0)
    cost = (total / TOKENS_PER_UNIT) * PRICE_PER_100K_TOKENS
    return cost.quantize(Decimal("0.000001"))


def record_usage(
    user_id: str,
    job_uuid: str,
    agent: str | None,
    model: str | None,
    input_tokens: int,
    output_tokens: int,
) -> Decimal:
    """Insert a usage_events row and atomically deduct cost from users.credits.

    Race-safe: the UPDATE … WHERE credits >= cost RETURNING guarantees we never
    go negative; if the balance is too low we still log the usage but skip the
    deduction (the user owes it — surfaced via account endpoint later).
    Returns the cost_usd that was recorded.
    """
    t0 = time.perf_counter()
    cost = cost_for_tokens(input_tokens, output_tokens)
    log_step(
        "usage.compute_cost",
        f"user={user_id} | job={job_uuid} | agent={agent} | model={model} | "
        f"in={input_tokens} out={output_tokens} | cost_usd={cost}",
    )
    db = get_supabase()
    db.table("usage_events").insert({
        "user_id": user_id,
        "job_uuid": job_uuid,
        "agent": agent,
        "model": model,
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
        "cost_usd": float(cost),
    }).execute()
    log_step("usage.ledger.inserted", f"job={job_uuid} | agent={agent} | cost={cost} | {(time.perf_counter()-t0)*1000:.1f}ms")

    if cost > 0:
        # Atomic conditional decrement; best-effort if balance has run dry.
        log_step("usage.deduct.start", f"user={user_id} | cost={cost}")
        try:
            db.rpc(
                "polaris_deduct_credits",
                {"p_user_id": user_id, "p_cost": float(cost)},
            ).execute()
            log_step("usage.deduct.attempted", f"user={user_id} | cost={cost} | {(time.perf_counter()-t0)*1000:.1f}ms")
        except Exception as exc:
            # Stub/dev path has no RPC; record but don't let billing crash the worker.
            log_step("usage.deduct.skipped", f"user={user_id} | reason={exc}")
    return cost


def grant_credits(user_id: str, amount_usd: Decimal | float) -> Decimal:
    """Add to a user's USD balance (subscription grant or top-up)."""
    amt = Decimal(str(amount_usd))
    t0 = time.perf_counter()
    log_step("credits.grant.start", f"user={user_id} | amount={amt}")
    db = get_supabase()
    rows = db.table("users").select("credits").eq("id", user_id).limit(1).execute().data
    current = Decimal(str(rows[0]["credits"])) if rows else Decimal(0)
    new_balance = (current + amt).quantize(Decimal("0.0001"))
    db.table("users").update({"credits": float(new_balance)}).eq("id", user_id).execute()
    log_step("credits.grant.done", f"user={user_id} | was={current} | now={new_balance} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return new_balance


# Legacy alias kept for any lingering import. No-op cost=1 decrement removed —
# gate via require_positive_balance instead.
def require_credits(user: dict, cost: int = 1) -> None:  # pragma: no cover
    require_positive_balance(user)