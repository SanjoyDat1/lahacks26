from __future__ import annotations

from fastapi import APIRouter

from ...config import load_settings
from ..schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    s = load_settings(validate=False)
    mode = getattr(s, "update_mode", "llm")
    return HealthResponse(
        ok=True,
        brian_reference_dir=str(s.brian_reference_dir),
        brain_dir=str(s.brain_dir),
        update_mode_default=mode,  # type: ignore[arg-type]
    )

