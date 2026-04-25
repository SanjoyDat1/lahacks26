from __future__ import annotations

from pathlib import Path

from ..config import Settings
from ..update import Operation, ReconciliationPlan
from .brain_files import ApplyResult, append_to_section, replace_section_block
from .retrieval_service import retrieval_service


def resolve_brain_root(settings: Settings) -> Path:
    return settings.brain_dir if settings.brain_dir.is_dir() else settings.brian_reference_dir


def apply_reconciliation_plan(
    plan: ReconciliationPlan,
    *,
    settings: Settings,
) -> ApplyResult:
    """Apply a reconciliation plan to the working brain (section-level ops)."""
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
        retrieval_service.invalidate(resolve_brain_root(settings))
    return ApplyResult(applied_ops=applied, files_touched=touched)


__all__ = ["apply_reconciliation_plan", "resolve_brain_root"]
