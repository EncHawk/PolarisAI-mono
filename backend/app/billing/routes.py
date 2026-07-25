from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.auth.sessions import current_user
from app.config import get_settings
from app.schemas import StripeCheckoutIn
from app.store.redis import get_redis
from app.store.supabase import get_supabase

router = APIRouter(prefix="/billing", tags=["billing"])

PLAN_COPY = {
    "starter": {
        "name": "Polaris Starter",
        "amount": 100,
        "description": "3 custom codes, shared GPU access, and 1 training job.",
    },
    "pro": {
        "name": "Polaris Pro",
        "amount": 2000,
        "description": "8 custom repos, full GPU access, and unlimited customisations.",
    },
}


def _stripe():
    settings = get_settings()
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe billing is not configured")
    try:
        import stripe
    except ImportError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe dependency is not installed") from exc
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def _owned_job(job_uuid: str | None, user_id: str) -> dict | None:
    if not job_uuid:
        return None
    rows = get_supabase().table("code").select("session_id,repo_name,user_id").eq("session_id", job_uuid).limit(1).execute().data
    if not rows or rows[0].get("user_id") != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your code session")
    return rows[0]


@router.post("/checkout")
async def create_checkout(body: StripeCheckoutIn, request: Request, user: dict = Depends(current_user)):
    """Create a Stripe Checkout Session for a Polaris plan.

    Price IDs are preferred in production. If they are omitted, Stripe receives
    inline price data so local development can still exercise the full flow.
    """
    stripe = _stripe()
    settings = get_settings()
    plan = PLAN_COPY[body.plan]
    _owned_job(body.job_uuid, user["sub"])
    price_id = settings.STRIPE_STARTER_PRICE_ID if body.plan == "starter" else settings.STRIPE_PRO_PRICE_ID
    recurring = body.plan == "pro"
    origin = request.headers.get("origin")
    success_url = f"{origin}/?checkout=success&session_id={{CHECKOUT_SESSION_ID}}" if origin else settings.STRIPE_SUCCESS_URL
    cancel_url = f"{origin}/?checkout=cancelled" if origin else settings.STRIPE_CANCEL_URL

    line_item: dict
    if price_id:
        line_item = {"price": price_id, "quantity": 1}
    else:
        price_data: dict = {
            "currency": "usd",
            "unit_amount": plan["amount"],
            "product_data": {"name": plan["name"], "description": plan["description"]},
        }
        if recurring:
            price_data["recurring"] = {"interval": "month"}
        line_item = {"price_data": price_data, "quantity": 1}

    session_args = {
        "mode": "subscription" if recurring else "payment",
        "line_items": [line_item],
        "customer_email": user.get("email"),
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {"user_id": user["sub"], "job_uuid": body.job_uuid or "", "plan": body.plan},
    }
    if recurring:
        session_args["subscription_data"] = {"metadata": {"user_id": user["sub"], "job_uuid": body.job_uuid or "", "plan": body.plan}}
    checkout = stripe.checkout.Session.create(
        **session_args,
    )
    return {"checkout_url": checkout.url, "session_id": checkout.id, "plan": body.plan}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None, alias="Stripe-Signature")):
    """Verify Stripe events and mark a linked code session as paid."""
    stripe = _stripe()
    settings = get_settings()
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe webhook is not configured")
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, settings.STRIPE_WEBHOOK_SECRET)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid Stripe webhook") from exc

    if event["type"] in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        job_uuid = metadata.get("job_uuid")
        if job_uuid:
            get_supabase().table("code").update({"payment_status": "paid"}).eq("session_id", job_uuid).execute()
            get_redis().hset(f"polaris:state:{job_uuid}", mapping={"payment_status": "paid", "stripe_session_id": session.get("id", "")})

    return {"received": True}
