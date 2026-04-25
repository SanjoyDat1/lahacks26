from __future__ import annotations

from fastapi import APIRouter

from ...services import agent_runner
from ..schemas import UpdateRequest, UpdateResponse

router = APIRouter()


@router.post("/update", response_model=UpdateResponse)
def update(req: UpdateRequest) -> UpdateResponse:
    out = agent_runner.update(
        req.prompt,
        update_mode=req.update_mode,
        apply=req.apply,
        source=req.source,
    )
    plan = out.get("plan")
    plan_dict = plan.to_dict() if hasattr(plan, "to_dict") else (plan if isinstance(plan, dict) else None)
    return UpdateResponse(
        mode=out.get("mode", "llm"),
        result_text=str(out.get("result_text", "")),
        applied=out.get("applied"),
        applied_ops=out.get("applied_ops"),
        files_touched=out.get("files_touched"),
        plan=plan_dict,
    )

