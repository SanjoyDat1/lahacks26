from __future__ import annotations

from pathlib import Path
from typing import Any

from ..builder import create_brain_from_documents
from ..config import Settings, ensure_working_brain, load_settings
from ..graph import run_task
from ..update import Operation, ReconciliationPlan
from .brain_files import ApplyResult, append_to_section, replace_section_block
from .retrieval_service import retrieval_service
from .update_modes import UpdateMode, run_deterministic_update, run_llm_update


def _resolve_brain_root(settings: Settings) -> Path:
    return settings.brain_dir if settings.brain_dir.is_dir() else settings.brian_reference_dir


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
    max_files: int = 3,
    settings: Settings | None = None,
) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    written = create_brain_from_documents(
        sources or [prompt],
        settings=s,
        initial_prompt=prompt,
        overwrite=overwrite,
        max_files=max_files,
    )
    retrieval_service.invalidate(_resolve_brain_root(s))
    return {"written_files": sorted(written.keys())}


def _apply_plan(
    plan: ReconciliationPlan,
    *,
    settings: Settings,
) -> ApplyResult:
    brain_root = settings.brain_dir
    touched: set[str] = set()
    applied = 0
    for op in plan.operations:
        if not isinstance(op, Operation):
            continue
        ok = False
        if op.kind == "ignore":
            ok = True
        elif op.kind == "append":
            ok = append_to_section(
                brain_root=brain_root,
                target_file=op.target_file,
                target_section_id=op.target_section_id,
                new_content=op.new_content,
            )
        elif op.kind in {"flag_conflict", "create_section"}:
            ok = append_to_section(
                brain_root=brain_root,
                target_file=op.target_file,
                target_section_id=op.target_section_id,
                new_content=op.new_content,
            )
        elif op.kind == "supersede":
            ok = replace_section_block(
                brain_root=brain_root,
                target_file=op.target_file,
                target_section_id=op.target_section_id,
                new_block=op.new_content,
            )

        if ok:
            applied += 1
            touched.add(op.target_file)
    if touched:
        retrieval_service.invalidate(_resolve_brain_root(settings))
    return ApplyResult(applied_ops=applied, files_touched=touched)


def update(
    prompt: str,
    *,
    update_mode: UpdateMode | None = None,
    apply: bool = True,
    source: dict[str, Any] | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)

    mode: UpdateMode = update_mode or getattr(s, "update_mode", "llm")
    if mode == "llm":
        return run_llm_update(prompt, settings=s)

    out = run_deterministic_update(prompt, settings=s, source=source or {})
    plan: ReconciliationPlan | None = out.get("plan")
    if apply and plan is not None and s.brain_dir.is_dir():
        applied = _apply_plan(plan, settings=s)
        out["applied"] = True
        out["applied_ops"] = applied.applied_ops
        out["files_touched"] = sorted(applied.files_touched)
    return out

