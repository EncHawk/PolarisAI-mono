from typing import Literal

from pydantic import BaseModel


class ExchangeIn(BaseModel):
    """Google ID token — the only thing the backend accepts from Google."""
    id_token: str


class AuthOut(BaseModel):
    user_id: str
    email: str
    name: str | None = None
    username: str | None = None
    github: str | None = None
    x: str | None = None
    api_key: str


class AccountOut(BaseModel):
    id: str
    email: str
    name: str | None = None
    username: str | None = None
    github: str | None = None
    x: str | None = None
    credits: float
    subscription_tier: str | None = None
    renews_at: str | None = None


class IngestIn(BaseModel):
    arxiv_id: str | None = None
    arxiv_url: str | None = None
    pdf_url: str | None = None


class IngestOut(BaseModel):
    job_uuid: str
    paper_id: str
    arxiv_id: str | None = None
    repo_name: str
    github_url: str | None = None
    repo_exists: bool = False
    requires_code_choice: bool = False
    payment_required: bool = True
    payment_status: Literal["unpaid", "pending", "paid"] = "unpaid"
    checkout_url: str | None = None
    repo_contents: list[dict] = []


class PaperOut(BaseModel):
    id: str
    job_uuid: str
    arxiv_id: str | None
    title: str | None
    status: str
    created_at: str | None = None


class CodeSessionOut(BaseModel):
    session_id: str
    user_name: str | None = None
    user_email: str
    user_id: str
    repo_name: str
    progress: Literal["failed", "completed", "in-progress"]
    execution_mode: Literal["create", "modify", "run"] | None = None
    payment_status: Literal["unpaid", "pending", "paid"]
    github_url: str | None = None
    repo_exists: bool = False
    repo_contents: list[dict] = []


class CodeChoiceIn(BaseModel):
    action: Literal["modify", "run"]


class PaymentWebhookIn(BaseModel):
    status: Literal["pending", "paid"]
    provider_reference: str | None = None


# Subscriptions: $5 / $20 / $200 per month, billed via Razorpay.
# `plan` identifies the tier; on capture/renew the backend grants that many
# USD credits to the user's account.
class RazorpayCheckoutIn(BaseModel):
    plan: Literal["starter", "pro", "lab"] = "starter"
    job_uuid: str | None = None


class RazorpayVerifyIn(BaseModel):
    order_id: str
    payment_id: str
    razorpay_signature: str
    plan: Literal["starter", "pro", "lab"] = "starter"
    job_uuid: str | None = None


class PlanFeedbackIn(BaseModel):
    approved: bool
    feedback: str = ""


class UsageReportIn(BaseModel):
    """Worker -> backend LLM token usage report. Deducted from users.credits."""
    user_id: str
    job_uuid: str
    agent: str | None = None
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0