from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.sessions import current_user
from app.schemas import PaperOut
from app.store.supabase import get_supabase

router = APIRouter(prefix="/list", tags=["list"])


@router.get("", response_model=list[PaperOut])
async def list_papers(user: dict = Depends(current_user)):
    db = get_supabase()
    rows = (
        db.table("papers")
        .select("id,job_uuid,arxiv_id,title,status,created_at")
        .eq("user_id", user["sub"])
        .order("created_at", desc=True)
        .limit(200)
        .execute()
        .data
    )
    return [PaperOut(**r) for r in rows]