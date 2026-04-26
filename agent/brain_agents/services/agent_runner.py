from __future__ import annotations

from typing import Any

from ..config import Settings, ensure_working_brain, load_settings
from ..graph import run_task
from ..ingestion_graph import run_initialize, run_update
from ..update import ReconciliationPlan
from ..update.governance import (
    gate_plan,
    make_plan_id,
    record_governance_tag,
)
from .reconciliation_apply import apply_reconciliation_plan, resolve_brain_root
from .update_modes import UpdateMode


def query(prompt: str, *, settings: Settings | None = None) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    text = run_task(user=prompt, task="query", settings=s)
    return {"result_text": text}


def bootstrap(
    prompt: str,
    sources: list[str],
    *,
    overwrite: bool = False,
    max_files: int = 24,
    settings: Settings | None = None,
) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    document_inputs = list(sources) if sources else [prompt]
    out = run_initialize(
        document_inputs,
        initial_prompt=prompt,
        settings=s,
        max_files=max_files,
        overwrite=overwrite,
    )
    return {
        "written_files": list(out.get("written_files", [])),
        "result_text": str(out.get("result_text", "")),
    }


def update(
    prompt: str,
    *,
    update_mode: UpdateMode | None = None,
    apply: bool = True,
    source: dict[str, Any] | None = None,
    require_approval: bool = False,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Run the update pipeline, optionally routing the plan through the governance gate.

    When ``require_approval=False`` (default) the call is byte-for-byte
    identical to the pre-governance behavior: ``run_update`` reconciles and,
    if ``apply=True``, mutates the brain.

    When ``require_approval=True`` we split reconcile from apply: the plan
    is built with ``apply=False``, classified by :func:`gate_plan`, and only
    auto-approved plans (high confidence × authoritative source) actually
    get applied. Pending plans are persisted via :func:`record_governance_tag`
    so a human can resolve them later via ``agent/scripts/review_pending.py``.
    """
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    mode_raw = str(update_mode or getattr(s, "update_mode", "llm") or "llm").lower()
    mode: UpdateMode = "deterministic" if mode_raw == "deterministic" else "llm"

    if not require_approval:
        return run_update(
            prompt,
            source=source,
            update_mode=mode,
            apply=apply,
            settings=s,
        )

    # Governance path: reconcile without applying so the gate can decide.
    src = dict(source or {})
    raw = run_update(
        prompt,
        source=src,
        update_mode=mode,
        apply=False,
        settings=s,
    )
    plan = raw.get("plan")
    if not isinstance(plan, ReconciliationPlan):
        # Pipeline produced no plan (empty input, error, deterministic
        # bypass). Fall through with the default response so callers see
        # the same shape as the non-governance path.
        raw.setdefault("status", None)
        return raw

    gate_plan(plan, src, require_approval=True)
    plan.plan_id = make_plan_id(plan, src)
    brain_root = resolve_brain_root(s)
    try:
        record_governance_tag(brain_root, plan, src)
    except OSError:
        # Audit-log failures must never abort the user-facing update.
        pass

    raw["plan"] = plan
    raw["status"] = plan.status

    if plan.status == "auto_approved" and apply and s.brain_dir.is_dir():
        applied = apply_reconciliation_plan(plan, settings=s)
        raw["applied"] = True
        raw["applied_ops"] = int(applied.applied_ops)
        raw["files_touched"] = sorted(applied.files_touched)
        existing = str(raw.get("result_text", "")).strip()
        suffix = (
            f"Auto-approved (confidence={plan.confidence:.2f}, plan_id={plan.plan_id})."
        )
        raw["result_text"] = f"{existing}\n{suffix}".strip() if existing else suffix
        return raw

    # pending_approval, or apply=False, or no working brain: do not mutate.
    raw["applied"] = False
    raw["applied_ops"] = 0
    raw["files_touched"] = []
    note = (
        f"Plan {plan.plan_id} pending human review "
        f"(confidence={plan.confidence:.2f}, status={plan.status}). "
        "Run `uv run python agent/scripts/review_pending.py` to approve or reject."
    )
    existing = str(raw.get("result_text", "")).strip()
    raw["result_text"] = f"{existing}\n{note}".strip() if existing else note
    return raw
