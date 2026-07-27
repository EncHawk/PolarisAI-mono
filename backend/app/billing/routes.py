from __future__ import annotations

import hashlib
import hmac
import time
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.auth.sessions import current_user, current_user_optional
from app.config import get_settings
from app.logging_utils import log_step, POLARIS_LOGGER
from app.schemas import RazorpayCheckoutIn, RazorpayVerifyIn
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/billing", tags=["billing"])

# Amounts in INR — Razorpay uses paise (1 INR = 100 paise)
PLAN_COPY: dict[str, dict[str, int | str]] = {
    "starter": {
        "name": "Polaris Starter",
        "amount_paise": 100_00,  # early bird ₹100 (~$1); list ₹500
        "description": "3 custom codes, 0.5× shared GPU, 1 training job.",
    },
    "pro": {
        "name": "Polaris Pro",
        "amount_paise": 1999_00,  # ₹1999/mo (~$20)
        "description": "8 custom repos, 1× full GPU access.",
    },
    "lab": {
        "name": "Polaris Lab",
        "amount_paise": 16999_00,  # ₹16999 (~$200)
        "description": "Unlimited customisations, up to 4× priority GPUs.",
    },
}


def _razorpay():
    settings = get_settings()
    if not settings.RAZORPAY_KEY_ID or not settings.RAZORPAY_KEY_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Razorpay is not configured")
    try:
        import razorpay
    except ImportError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Razorpay dependency is not installed") from exc
    client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
    return client


def _owned_job(job_uuid: str | None, user_id: str) -> dict | None:
    if not job_uuid:
        return None
    rows = (
        get_supabase()
        .table("code")
        .select("session_id, repo_name, user_id")
        .eq("session_id", job_uuid)
        .limit(1)
        .execute()
        .data
    )
    if not rows or rows[0].get("user_id") != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your code session")
    return rows[0]


@router.post("/checkout")
async def create_order(
    body: RazorpayCheckoutIn,
    user: dict | None = Depends(current_user_optional),
):
    """Create a Razorpay order for a Polaris plan and return order_id + amount.

    Auth is optional for landing-page plan purchases. A job_uuid still requires
    the owning user so we never mark someone else's session paid.
    """
    t0 = time.perf_counter()
    user_id = (user or {}).get("sub") or "guest"
    user_email = (user or {}).get("email") or ""
    log_step("billing.checkout.start", f"plan={body.plan} | user={user_id} | job={body.job_uuid}")
    client = _razorpay()
    plan = PLAN_COPY[body.plan]
    if body.job_uuid:
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in to pay for a code session")
        _owned_job(body.job_uuid, user["sub"])

    amount_paise = plan["amount_paise"]
    if amount_paise < 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "minimum amount is 100 paise (₹1)")

    receipt = f"polaris_{user_id[:24]}_{int(time.time())}"

    t1 = time.perf_counter()
    order = client.order.create(
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "user_id": user_id,
                "user_email": user_email,
                "job_uuid": body.job_uuid or "",
                "plan": body.plan,
            },
        }
    )
    log_step("billing.checkout.razorpay", f"order_id={order['id']} | {(time.perf_counter()-t1)*1000:.1f}ms")
    log_step("billing.checkout.done", f"total={(time.perf_counter()-t0)*1000:.1f}ms")
    settings = get_settings()
    return {
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "plan": body.plan,
        "key_id": settings.RAZORPAY_KEY_ID,
        "name": plan["name"],
        "description": plan["description"],
    }


@router.post("/verify")
async def verify_payment(
    body: RazorpayVerifyIn,
    user: dict | None = Depends(current_user_optional),
):
    """Verify the Razorpay signature after the frontend receives payment details."""
    t0 = time.perf_counter()
    user_id = (user or {}).get("sub") or "guest"
    log_step("billing.verify.start", f"order={body.order_id} | job={body.job_uuid} | user={user_id}")
    settings = get_settings()
    if not settings.RAZORPAY_KEY_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Razorpay is not configured")

    # Build the expected signature: HMAC-SHA256 of "order_id|payment_id"
    payload = f"{body.order_id}|{body.payment_id}"
    expected_sig = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, body.razorpay_signature):
        POLARIS_LOGGER.warning("billing.verify.sig_mismatch | order=%s | user=%s | %.1fms", body.order_id, user_id, (time.perf_counter()-t0)*1000)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signature mismatch")

    # Mark the code session as paid (requires owner when a job is linked)
    job_uuid = body.job_uuid
    if job_uuid:
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in to verify a code session payment")
        _owned_job(job_uuid, user["sub"])
        t1 = time.perf_counter()
        get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
        get_redis().hset(
            f"polaris:state:{job_uuid}",
            mapping={"payment_status": "paid", "razorpay_order_id": body.order_id, "razorpay_payment_id": body.payment_id},
        )
        log_step("billing.verify.db", f"job={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")

    log_step("billing.verify.done", f"total={(time.perf_counter()-t0)*1000:.1f}ms")
    return {"status": "ok", "plan": body.plan}


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request, x_razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature")):
    """Verify Razorpay webhook events and mark the linked code session as paid."""
    t0 = time.perf_counter()
    log_step("billing.webhook.start", f"razorpay_sig_present={bool(x_razorpay_signature)}")
    settings = get_settings()
    if not settings.RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Razorpay webhook secret is not configured")

    payload = await request.body()

    # Verify webhook signature
    expected_sig = hmac.new(
        settings.RAZORPAY_WEBHOOK_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, x_razorpay_signature or ""):
        POLARIS_LOGGER.warning("billing.webhook.sig_mismatch | %.1fms", (time.perf_counter()-t0)*1000)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid Razorpay webhook signature")

    import json

    event = json.loads(payload)
    event_type = event.get("event", "")
    log_step("billing.webhook.event", f"type={event_type}")

    # Payment succeeded
    if event_type in {"payment.captured", "order.paid"}:
        payload_data = event.get("payload", {})
        order_payload = payload_data.get("order", {}).get("properties", {})
        notes = order_payload.get("notes", {})
        job_uuid = notes.get("job_uuid")

        if job_uuid:
            t1 = time.perf_counter()
            get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
            get_redis().hset(f"polaris:state:{job_uuid}", mapping={"payment_status": "paid"})
            log_step("billing.webhook.db", f"job={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")

    log_step("billing.webhook.done", f"total={(time.perf_counter()-t0)*1000:.1f}ms")
    return {"received": True}
