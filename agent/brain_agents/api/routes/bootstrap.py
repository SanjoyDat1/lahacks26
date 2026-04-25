from __future__ import annotations

from fastapi import APIRouter

from ...services import agent_runner
from ..schemas import BootstrapRequest, BootstrapResponse

router = APIRouter()


@router.post("/bootstrap", response_model=BootstrapResponse)
def bootstrap(req: BootstrapRequest) -> BootstrapResponse:
    out = agent_runner.bootstrap(
        req.prompt,
        req.sources,
        overwrite=req.overwrite,
        max_files=req.max_files,
    )
    return BootstrapResponse(written_files=list(out.get("written_files", [])))

