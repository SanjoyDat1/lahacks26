"""Update / Reconciliation module for the project brain.

This module owns the *write side* of the brain pipeline: given a piece of
incoming text plus its source metadata, it produces a
:class:`ReconciliationPlan` describing how the working brain should change
(append, supersede, flag conflict, ignore, or create new section), without
actually mutating any files. The plan is appended to a JSON-lines audit log
under ``<brain_root>/.audit/log.jsonl`` so every decision is replayable.

The public surface is intentionally small:

* :class:`Reconciler` -- top-level orchestrator that combines fact extraction,
  retrieval-based context lookup, and operation decisions.
* :class:`ReconciliationPlan` -- the structured output returned by
  ``Reconciler.reconcile``.
* :class:`Operation` -- one atomic write decision inside a plan.
* :func:`format_operation` -- renders a single operation as readable Markdown
  for humans browsing the audit log.

The module is designed to degrade gracefully: it works with no API keys, no
network, and no model downloads, because an LLM-free heuristic path is wired in
behind every component (see :mod:`extractor`, :mod:`decider`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

OperationKind = Literal[
    "append",
    "supersede",
    "flag_conflict",
    "ignore",
    "create_section",
]


@dataclass
class Operation:
    """One atomic write decision proposed by the reconciler.

    Operations are *proposals*: nothing is written to disk by ``Reconciler``
    itself. A downstream Writer agent (or a human reviewer) is expected to
    apply them.
    """

    kind: OperationKind
    target_file: str
    target_section_id: str | None
    new_content: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "target_file": self.target_file,
            "target_section_id": self.target_section_id,
            "new_content": self.new_content,
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Operation":
        return cls(
            kind=d["kind"],
            target_file=d["target_file"],
            target_section_id=d.get("target_section_id"),
            new_content=d.get("new_content", ""),
            reason=d.get("reason", ""),
        )


PlanStatus = Literal[
    "applied",
    "auto_approved",
    "pending_approval",
    "approved",
    "rejected",
]


@dataclass
class ReconciliationPlan:
    """A complete proposal for how a single incoming text should change the brain.

    Attributes
    ----------
    operations
        Ordered list of :class:`Operation` instances; an empty list means the
        text was deemed redundant or below the noise floor.
    rationale
        Short, human-readable summary of *why* this plan was chosen. Surfaces
        in the audit log and in the agent UI.
    related_sections
        ``section_id`` strings (``"file.md#heading"``) that were used as
        context when forming the plan. Useful for explainability.
    confidence
        Average per-fact confidence in ``[0.0, 1.0]``. Heuristic-extracted
        facts are intentionally capped lower than LLM-extracted ones.
    timestamp
        ISO-8601 UTC timestamp when the plan was constructed (auto-filled).
    status
        Governance routing tag. Defaults to ``"applied"`` so legacy callers
        that don't use the gate behave exactly as before.
    plan_id
        Short, stable handle assigned by the governance layer when a plan is
        persisted for later human review. Empty string for ungated plans.
    """

    operations: list[Operation] = field(default_factory=list)
    rationale: str = ""
    related_sections: list[str] = field(default_factory=list)
    confidence: float = 0.0
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    status: PlanStatus = "applied"
    plan_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "rationale": self.rationale,
            "confidence": self.confidence,
            "related_sections": list(self.related_sections),
            "operations": [op.to_dict() for op in self.operations],
            "status": self.status,
            "plan_id": self.plan_id,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ReconciliationPlan":
        plan = cls(
            operations=[Operation.from_dict(o) for o in d.get("operations", [])],
            rationale=d.get("rationale", ""),
            related_sections=list(d.get("related_sections", [])),
            confidence=float(d.get("confidence", 0.0)),
            status=d.get("status", "applied"),
            plan_id=str(d.get("plan_id", "")),
        )
        if "timestamp" in d:
            plan.timestamp = d["timestamp"]
        return plan


def format_operation(op: Operation) -> str:
    """Render a single :class:`Operation` as a Markdown block.

    Used by the audit log viewer and by the writer agent's chat output. Output
    is intentionally small (a heading, a metadata line, a fenced content
    block) so several operations stack cleanly in one chat message.
    """
    target = op.target_file
    if op.target_section_id:
        target = f"{op.target_file} ({op.target_section_id})"

    body = (op.new_content or "").rstrip()
    if not body:
        body_block = "_(no content payload)_"
    else:
        body_block = f"```markdown\n{body}\n```"

    return (
        f"### {op.kind.upper()} -> {target}\n"
        f"_Reason:_ {op.reason}\n\n"
        f"{body_block}"
    )


from .reconciler import Reconciler  # noqa: E402  (placed after dataclasses to avoid cycles)

__all__ = [
    "Operation",
    "OperationKind",
    "PlanStatus",
    "ReconciliationPlan",
    "Reconciler",
    "format_operation",
]
