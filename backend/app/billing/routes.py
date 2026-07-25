from __future__ import annotations

import hashlib
import hmac
import time
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.auth.sessions import current_user
from app.config import get_settings
from app.schemas import RazorpayCheckoutIn, RazorpayVerifyIn
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/billing", tags=["billing"])

# Amounts in INR — Razorpay uses paise (1 INR = 100 paise)
PLAN_COPY: dict[str, dict[str, int | str]] = {
    "starter": {
        "name": "Polaris Starter",
        "amount_paise": 100_00,  # ₹100 = 10000 paise
        "description": "3 custom codes, shared GPU access, and 1 training job.",
    },
    "pro": {
        "name": "Polaris Pro",
        "amount_paise": 2000_00,  # ₹2000 = 200000 paise
        "description": "8 custom repos, full GPU access, and unlimited customisations.",
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
    user: dict = Depends(current_user),
):
    """Create a Razorpay order for a Polaris plan and return order_id + amount."""
    client = _razorpay()
    plan = PLAN_COPY[body.plan]
    _owned_job(body.job_uuid, user["sub"])

    amount_paise = plan["amount_paise"]
    if amount_paise < 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "minimum amount is 100 paise (₹1)")

    receipt = f"polaris_{user['sub']}_{int(time.time())}"

    order = client.order.create(
        {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "user_id": user["sub"],
                "user_email": user.get("email", ""),
                "job_uuid": body.job_uuid or "",
                "plan": body.plan,
            },
            "metadata": {
                "user_id": user["sub"],
                "job_uuid": body.job_uuid or "",
                "plan": body.plan,
            },
        }
    )

    return {
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "plan": body.plan,
    }


@router.post("/verify")
async def verify_payment(
    body: RazorpayVerifyIn,
    user: dict = Depends(current_user),
):
    """Verify the Razorpay signature after the frontend receives payment details."""
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signature mismatch")

    # Mark the code session as paid
    job_uuid = body.job_uuid
    if job_uuid:
        get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
        get_redis().hset(
            f"polaris:state:{job_uuid}",
            mapping={"payment_status": "paid", "razorpay_order_id": body.order_id, "razorpay_payment_id": body.payment_id},
        )

    return {"status": "ok", "plan": body.plan}


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request, x_razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature")):
    """Verify Razorpay webhook events and mark the linked code session as paid."""
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid Razorpay webhook signature")

    import json

    event = json.loads(payload)
    event_type = event.get("event", "")

    # Payment succeeded
    if event_type in {"payment.captured", "order.paid"}:
        payload_data = event.get("payload", {})
        order_payload = payload_data.get("order", {}).get("properties", {})
        notes = order_payload.get("notes", {})
        job_uuid = notes.get("job_uuid")

        if job_uuid:
            get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
            get_redis().hset(f"polaris:state:{job_uuid}", mapping={"payment_status": "paid"})

    return {"received": True}
