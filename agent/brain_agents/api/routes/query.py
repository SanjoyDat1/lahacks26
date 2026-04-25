from __future__ import annotations

from fastapi import APIRouter

from ...services import agent_runner
from ..schemas import QueryRequest, QueryResponse

router = APIRouter()


@router.post("/query", response_model=QueryResponse)
def query(req: QueryRequest) -> QueryResponse:
    out = agent_runner.query(req.prompt)
    return QueryResponse(result_text=str(out.get("result_text", "")))

