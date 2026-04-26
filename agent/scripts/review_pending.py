"""CLI: list pending plans and approve/reject one at a time.

Usage::

    uv run python agent/scripts/review_pending.py
    uv run python agent/scripts/review_pending.py --brain-root <path>

For each pending plan written by the governance gate the script prints a
short summary and prompts ``y`` (approve and apply), ``n`` (reject, with a
reason), or ``s`` (skip for this run). All decisions are appended to the
audit log so they're replayable.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from brain_agents.config import load_settings
from brain_agents.services.reconciliation_apply import (
    apply_reconciliation_plan,
    resolve_brain_root,
)
from brain_agents.update import ReconciliationPlan
from brain_agents.update.governance import load_pending, record_decision


def _summarize(entry: dict) -> str:
    plan = entry.get("plan", {}) or {}
    source = entry.get("source", {}) or {}
    pid = plan.get("plan_id") or "<no-id>"
    confidence = float(plan.get("confidence") or 0.0)
    ops = plan.get("operations") or []
    rationale = str(plan.get("rationale") or "").strip().replace("\n", " ")
    if len(rationale) > 240:
        rationale = rationale[:237] + "..."
    src_kind = source.get("kind") or "(unknown)"
    src_url = source.get("url") or ""
    op_lines = []
    for op in ops[:6]:
        kind = op.get("kind", "?")
        target = op.get("target_file", "?")
        section = op.get("target_section_id") or ""
        op_lines.append(
            f"    - {kind} -> {target}{' (' + section + ')' if section else ''}"
        )
    if len(ops) > 6:
        op_lines.append(f"    - ... {len(ops) - 6} more")
    return (
        f"plan_id   : {pid}\n"
        f"source    : {src_kind} {src_url}".rstrip()
        + "\n"
        + f"confidence: {confidence:.2f}\n"
        f"ops ({len(ops)}):\n" + ("\n".join(op_lines) or "    (none)") + "\n"
        f"rationale : {rationale or '(empty)'}"
    )


def _resolve_brain_root_arg(arg: str | None) -> Path:
    if arg:
        return Path(arg).expanduser().resolve()
    settings = load_settings(validate=False)
    return resolve_brain_root(settings)


def _read_decision(prompt: str = "Approve [y/n/s]? ") -> str:
    try:
        raw = input(prompt).strip().lower()
    except EOFError:
        return "s"
    return raw or "s"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--brain-root",
        default=None,
        help="Override the brain root (defaults to settings.brain_dir).",
    )
    parser.add_argument(
        "--approver",
        default="cli",
        help="Identifier recorded on each governance_decision entry.",
    )
    args = parser.parse_args(argv)

    brain_root = _resolve_brain_root_arg(args.brain_root)
    if not brain_root.exists():
        print(f"Brain root does not exist: {brain_root}", file=sys.stderr)
        return 1

    pending = load_pending(brain_root)
    if not pending:
        print("No pending plans.")
        return 0

    settings = load_settings(validate=False)
    print(f"Found {len(pending)} pending plan(s) at {brain_root}.")
    for i, entry in enumerate(pending, start=1):
        print()
        print(f"=== Plan {i} of {len(pending)} ===")
        print(_summarize(entry))

        choice = _read_decision()
        plan_dict = entry.get("plan", {}) or {}
        plan_id = str(plan_dict.get("plan_id") or "")
        if choice.startswith("y"):
            plan = ReconciliationPlan.from_dict(plan_dict)
            try:
                applied = apply_reconciliation_plan(plan, settings=settings)
            except OSError as exc:
                print(f"  apply failed: {exc}; recording rejection instead.")
                record_decision(
                    brain_root,
                    plan_id,
                    "rejected",
                    args.approver,
                    reason=f"apply error: {exc}",
                )
                continue
            print(
                f"  applied {applied.applied_ops} op(s); "
                f"files touched: {sorted(applied.files_touched) or 'none'}"
            )
            record_decision(brain_root, plan_id, "approved", args.approver)
        elif choice.startswith("n"):
            try:
                reason = input("  reason (optional): ").strip()
            except EOFError:
                reason = ""
            record_decision(brain_root, plan_id, "rejected", args.approver, reason=reason)
            print("  recorded rejection.")
        else:
            print("  skipped.")
            continue

    return 0


if __name__ == "__main__":
    sys.exit(main())
