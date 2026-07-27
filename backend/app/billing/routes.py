from __future__ import annotations

import hashlib
import hmac
import time
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.auth.sessions import current_user_optional, grant_credits
from app.config import get_settings
from app.logging_utils import POLARIS_LOGGER, log_step
from app.schemas import RazorpayCheckoutIn, RazorpayVerifyIn
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/billing", tags=["billing"])

# Razorpay uses paise (1 INR = 100 paise). The amount_paise below are the listed
# INR prices; on capture/renewal we credit the dollar-denominated tier value to
# the user's USD balance (grant_usd).
SUBSCRIPTION_PLANS: dict[str, dict[str, object]] = {
    "starter": {
        "name": "Polaris Starter",
        "amount_paise": 100_00,        # ₹100/mo  (~$1/mo — early bird launch price)
        "description": "$1/mo — ~10M tokens (input + output) per month. Early bird: pay $1, get $5 in credits.",
        "grant_usd": Decimal("5.00"),  # Early bird: still grant $5 even at $1 price
    },
    "pro": {
        "name": "Polaris Pro",
        "amount_paise": 1999_00,      # ₹1999/mo (~$20/mo)
        "description": "$20/mo — ~40M tokens (input + output) per month.",
        "grant_usd": Decimal("20.00"),
    },
    "lab": {
        "name": "Polaris Lab",
        "amount_paise": 16999_00,     # ₹16999/mo (~$200/mo)
        "description": "$200/mo — ~400M tokens (input + output) per month.",
        "grant_usd": Decimal("200.00"),
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
    return razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))


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


def _finalize_subscription(
    user_id: str, plan: str, order_id: str | None, payment_id: str | None,
    subscription_id: str | None = None,
) -> Decimal:
    """Grant the plan's USD value to the user and stamp subscription state."""
    t0 = time.perf_counter()
    plan_cfg = SUBSCRIPTION_PLANS[plan]
    grant = Decimal(str(plan_cfg["grant_usd"]))
    log_step("billing.subscription.finalize.start", f"user={user_id} | plan={plan} | grant={grant} | order={order_id} | sub={subscription_id}")
    new_balance = grant_credits(user_id, grant)
    # Stamp subscription state. renewals land as a new checkout each cycle.
    patch: dict[str, object] = {
        "subscription_tier": plan,
        "subscription_id": subscription_id or order_id,
    }
    get_supabase().table("users").update(patch).eq("id", user_id).execute()
    log_step("billing.subscription.finalize.done", f"user={user_id} | plan={plan} | balance={new_balance} | {(time.perf_counter()-t0)*1000:.1f}ms")
    return new_balance


@router.post("/checkout")
async def create_order(
    body: RazorpayCheckoutIn,
    user: dict | None = Depends(current_user_optional),
):
    """Create a Razorpay order for a Polaris subscription plan.

    Auth is optional for landing-page purchases; a logged-in user gets their
    subscription_id stamped on capture. A `job_uuid` (legacy per-job payment)
    still requires the owning user.
    """
    t0 = time.perf_counter()
    user_id = (user or {}).get("sub") or "guest"
    user_email = (user or {}).get("email") or ""
    log_step("billing.checkout.start", f"plan={body.plan} | user={user_id} | authed={bool(user)} | job={body.job_uuid}")
    client = _razorpay()
    plan = SUBSCRIPTION_PLANS[body.plan]
    if body.job_uuid:
        if not user:
            log_step("billing.checkout.reject", "reason=guest_cannot_pay_for_job")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in to pay for a code session")
        log_step("billing.checkout.owner_check", f"job={body.job_uuid} | user={user['sub']}")
        _owned_job(body.job_uuid, user["sub"])

    amount_paise = int(plan["amount_paise"])
    if amount_paise < 100:
        log_step("billing.checkout.reject", f"reason=below_minimum | amount_paise={amount_paise}")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "minimum amount is 100 paise (₹1)")

    receipt = f"p_{user_id[:16]}_{int(time.time())}"

    t1 = time.perf_counter()
    log_step("billing.checkout.razorpay.call", f"amount={amount_paise} | receipt={receipt}")
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
    log_step("billing.checkout.razorpay.done", f"order_id={order['id']} | {(time.perf_counter()-t1)*1000:.1f}ms")
    log_step("billing.checkout.done", f"plan={body.plan} | order={order['id']} | total={(time.perf_counter()-t0)*1000:.1f}ms")
    settings = get_settings()
    return {
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "plan": body.plan,
        "key_id": settings.RAZORPAY_KEY_ID,
        "name": plan["name"],
        "description": plan["description"],
        "grant_usd": float(plan["grant_usd"]),
    }


@router.post("/verify")
async def verify_payment(
    body: RazorpayVerifyIn,
    user: dict | None = Depends(current_user_optional),
):
    """Verify the Razorpay signature after the frontend receives payment details.

    On success, the plan's USD value is granted to the user's credit balance
    (when signed in). Legacy per-job `payment_status=paid` is still stamped
    when a job_uuid is supplied.
    """
    t0 = time.perf_counter()
    user_id = (user or {}).get("sub") or "guest"
    log_step("billing.verify.start", f"order={body.order_id} | job={body.job_uuid} | user={user_id}")
    settings = get_settings()
    if not settings.RAZORPAY_KEY_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Razorpay is not configured")

    payload = f"{body.order_id}|{body.payment_id}"
    expected_sig = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, body.razorpay_signature):
        POLARIS_LOGGER.warning("billing.verify.sig_mismatch | order=%s | user=%s | %.1fms", body.order_id, user_id, (time.perf_counter()-t0)*1000)
        log_step("billing.verify.reject", f"order={body.order_id} | reason=sig_mismatch")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signature mismatch")

    log_step("billing.verify.sig_ok", f"order={body.order_id} | user={user_id}")

    # Grant the subscription's USD value to a logged-in user.
    if user:
        log_step("billing.verify.grant", f"user={user['sub']} | plan={body.plan}")
        _finalize_subscription(user["sub"], body.plan, body.order_id, body.payment_id)
    else:
        log_step("billing.verify.skip_grant", "user=guest | no api key presented")

    # Legacy per-job payment surface: keep stamping payment_status when linked.
    job_uuid = body.job_uuid
    if job_uuid:
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in to verify a code session payment")
        log_step("billing.verify.legacy_job", f"job={job_uuid} | user={user['sub']}")
        _owned_job(job_uuid, user["sub"])
        t1 = time.perf_counter()
        get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
        get_redis().hset(
            f"polaris:state:{job_uuid}",
            mapping={"payment_status": "paid", "razorpay_order_id": body.order_id, "razorpay_payment_id": body.payment_id},
        )
        log_step("billing.verify.db", f"job={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")

    log_step("billing.verify.done", f"plan={body.plan} | total={(time.perf_counter()-t0)*1000:.1f}ms")
    return {"status": "ok", "plan": body.plan}


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request, x_razorpay_signature: str | None = Header(default=None, alias="X-Razorpay-Signature")):
    """Verify Razorpay webhook events.

    Fires for both one-shot checkout captures and recurring subscription
    renewals. On `payment.captured`/`order.paid` we look up the user_id + plan
    from the order notes and grant the plan's USD value to that user's balance.
    """
    t0 = time.perf_counter()
    log_step("billing.webhook.start", f"razorpay_sig_present={bool(x_razorpay_signature)}")
    settings = get_settings()
    if not settings.RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Razorpay webhook secret is not configured")

    payload = await request.body()
    expected_sig = hmac.new(
        settings.RAZORPAY_WEBHOOK_SECRET.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, x_razorpay_signature or ""):
        POLARIS_LOGGER.warning("billing.webhook.sig_mismatch | %.1fms", (time.perf_counter()-t0)*1000)
        log_step("billing.webhook.reject", "reason=sig_mismatch")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid Razorpay webhook signature")
    log_step("billing.webhook.sig_ok", "signature verified")

    import json

    event = json.loads(payload)
    event_type = event.get("event", "")
    log_step("billing.webhook.event", f"type={event_type}")

    if event_type in {"payment.captured", "order.paid", "subscription.charged"}:
        payload_data = event.get("payload", {})
        # Razorpay nests notes differently for orders vs subscriptions; try both.
        order_payload = payload_data.get("order", {}).get("properties", {})
        sub_payload = payload_data.get("subscription", {}).get("properties", {})
        payment_payload = payload_data.get("payment", {}).get("entity", {})
        notes = order_payload.get("notes", {}) or sub_payload.get("notes", {}) or payment_payload.get("notes", {})
        user_id = notes.get("user_id")
        plan = notes.get("plan")
        log_step("billing.webhook.notes", f"user={user_id} | plan={plan} | job={notes.get('job_uuid')}")

        if user_id and plan and plan in SUBSCRIPTION_PLANS:
            sub_id = (sub_payload.get("id")
                      or order_payload.get("id")
                      or payment_payload.get("subscription_id"))
            log_step("billing.webhook.finalize", f"user={user_id} | plan={plan} | sub_id={sub_id} | payment_id={payment_payload.get('id')}")
            _finalize_subscription(user_id, plan, None, payment_payload.get("id"), subscription_id=sub_id)
        else:
            log_step("billing.webhook.skip_grant", f"reason=missing_notes | user={user_id} | plan={plan}")

        # Legacy per-job marking (kept for older in-flight sessions).
        job_uuid = notes.get("job_uuid")
        if job_uuid:
            t1 = time.perf_counter()
            get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
            get_redis().hset(f"polaris:state:{job_uuid}", mapping={"payment_status": "paid"})
            log_step("billing.webhook.legacy_db", f"job={job_uuid} | {(time.perf_counter()-t1)*1000:.1f}ms")
    else:
        log_step("billing.webhook.ignored", f"type={event_type} not in capture/paid/charged")

    log_step("billing.webhook.done", f"type={event_type} | total={(time.perf_counter()-t0)*1000:.1f}ms")
    return {"received": True}