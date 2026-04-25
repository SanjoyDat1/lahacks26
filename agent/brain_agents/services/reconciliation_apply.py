from __future__ import annotations

from pathlib import Path

from ..config import Settings
from ..update import Operation, ReconciliationPlan
from .brain_files import ApplyResult, append_to_section, replace_section_block
from .retrieval_service import retrieval_service


def resolve_brain_root(settings: Settings) -> Path:
    return settings.brain_dir if settings.brain_dir.is_dir() else settings.brian_reference_dir


def _make_title(relative_path: str) -> str:
    return (
        Path(relative_path)
        .stem
        .replace("_", " ")
        .replace("-", " ")
        .title()
    )


def apply_single_operation(op: Operation, *, brain_root: Path) -> tuple[bool, str]:
    """Apply one Operation to the brain. Returns (success, change_type).

    change_type is one of: 'appended', 'superseded', 'created', 'ignored', 'failed'.
    """
    if not isinstance(op, Operation):
        return False, "failed"

    if op.kind == "ignore":
        return True, "ignored"

    if op.kind in {"append", "flag_conflict"}:
        ok = append_to_section(
            brain_root=brain_root,
            target_file=op.target_file,
            target_section_id=op.target_section_id,
            new_content=op.new_content,
        )
        return ok, "appended" if ok else "failed"

    if op.kind == "create_section":
        ok = append_to_section(
            brain_root=brain_root,
            target_file=op.target_file,
            target_section_id=op.target_section_id,
            new_content=op.new_content,
        )
        if ok:
            return True, "appended"
        # Target file doesn't exist yet — create it with proper frontmatter
        file_path = (brain_root / op.target_file).resolve()
        if not str(file_path).startswith(str(brain_root.resolve())):
            return False, "failed"  # path traversal guard
        file_path.parent.mkdir(parents=True, exist_ok=True)
        title = _make_title(op.target_file)
        slug = Path(op.target_file).stem
        content = (
            f"---\n"
            f"id: {slug}\n"
            f"title: {title}\n"
            f"importance: medium\n"
            f"---\n\n"
            f"{op.new_content.strip()}\n"
        )
        file_path.write_text(content, encoding="utf-8")
        return True, "created"

    if op.kind == "supersede":
        ok = replace_section_block(
            brain_root=brain_root,
            target_file=op.target_file,
            target_section_id=op.target_section_id,
            new_block=op.new_content,
        )
        return ok, "superseded" if ok else "failed"

    return False, "failed"


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
        ok, _ = apply_single_operation(op, brain_root=brain_root)
        if ok and op.kind != "ignore":
            applied += 1
            touched.add(op.target_file)
    if touched:
        retrieval_service.invalidate(resolve_brain_root(settings))
    return ApplyResult(applied_ops=applied, files_touched=touched)


__all__ = ["apply_reconciliation_plan", "apply_single_operation", "resolve_brain_root"]
