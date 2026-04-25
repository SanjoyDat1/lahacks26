from __future__ import annotations

from typing import Any, Literal

from ..config import Settings
from ..graph import run_task
from ..update import ReconciliationPlan, Reconciler
from .retrieval_service import retrieval_service

UpdateMode = Literal["llm", "deterministic"]


def run_llm_update(prompt: str, *, settings: Settings) -> dict[str, Any]:
    text = run_task(user=prompt, task="update", settings=settings)
    return {
        "mode": "llm",
        "result_text": text,
        "plan": None,
        "applied": None,
    }


def run_deterministic_update(
    prompt: str,
    *,
    settings: Settings,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    retriever = retrieval_service.get(settings.brain_dir if settings.brain_dir.is_dir() else settings.brian_reference_dir)
    rec = Reconciler(retriever=retriever, use_llm=False)
    plan = rec.reconcile(prompt, source=source or {})
    return {
        "mode": "deterministic",
        "result_text": "",
        "plan": plan,
        "applied": False,
    }

