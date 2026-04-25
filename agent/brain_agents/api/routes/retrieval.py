from __future__ import annotations

from fastapi import APIRouter

from ...config import load_settings
from ...services.retrieval_service import retrieval_service
from ..schemas import (
    RetrievalBriefRequest,
    RetrievalReloadResponse,
    RetrievalResponse,
    RetrievalSearchRequest,
)

router = APIRouter(prefix="/retrieval")


def _brain_root():
    s = load_settings(validate=False)
    return s.brain_dir if s.brain_dir.is_dir() else s.brian_reference_dir


@router.post("/search", response_model=RetrievalResponse)
def search(req: RetrievalSearchRequest) -> RetrievalResponse:
    r = retrieval_service.get(_brain_root())
    hits = r.query(req.query, top_k=req.top_k, token_budget=req.token_budget)
    return RetrievalResponse(
        backend_label=r.backend_label,
        num_sections=r.num_sections,
        hits=[retrieval_service.hit_to_dict(h) for h in hits],
    )


@router.post("/brief", response_model=RetrievalResponse)
def brief(req: RetrievalBriefRequest) -> RetrievalResponse:
    r = retrieval_service.get(_brain_root())
    hits = r.query(req.task, top_k=req.top_k, token_budget=req.token_budget)
    return RetrievalResponse(
        backend_label=r.backend_label,
        num_sections=r.num_sections,
        hits=[retrieval_service.hit_to_dict(h) for h in hits],
    )


@router.post("/reload", response_model=RetrievalReloadResponse)
def reload_index() -> RetrievalReloadResponse:
    r = retrieval_service.reload(_brain_root())
    return RetrievalReloadResponse(ok=True, backend_label=r.backend_label, num_sections=r.num_sections)

