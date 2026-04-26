"""Plan-level governance: decide whether to auto-apply or queue for review.

The Reconciler always produces a typed :class:`ReconciliationPlan`. This
module adds a thin routing layer that classifies each plan as either
``auto_approved`` (safe to apply immediately) or ``pending_approval``
(should be deferred to a human reviewer) based on plan confidence and the
authority weight of its source.

The gate is intentionally placed at the *call site*, not inside the
Reconciler -- that keeps the reconciliation pipeline single-purpose and
lets governance policy evolve (RBAC, two-of-three sign-off, regulator
review) without rewriting the data layer.
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any

from . import ReconciliationPlan
from .audit import AuditLog

# Defaults conservative enough for a hackathon demo. Tune in production.
DEFAULT_CONFIDENCE_THRESHOLD = 0.75
DEFAULT_AUTHORITY_THRESHOLD = 0.70


def make_plan_id(plan: ReconciliationPlan, source: dict[str, Any]) -> str:
    """Stable hash so the same plan can be referenced across runs.

    The hash mixes the wall clock, source URL, and a slice of the rationale
    so concurrently produced plans collide only if they're effectively the
    same proposal.
    """
    raw = f"{time.time():.6f}:{source.get('url','')}:{plan.rationale[:120]}".encode()
    return hashlib.sha1(raw).hexdigest()[:12]


def gate_plan(
    plan: ReconciliationPlan,
    source: dict[str, Any],
    *,
    require_approval: bool,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    authority_threshold: float = DEFAULT_AUTHORITY_THRESHOLD,
) -> ReconciliationPlan:
    """Tag a plan with ``auto_approved`` or ``pending_approval`` based on thresholds.

    Returns the same plan object with ``.status`` mutated. Pure routing --
    no side effects, no audit log write, no apply call.

    When ``require_approval=False`` the plan keeps the legacy ``"applied"``
    status so callers that don't opt into governance see no behavior change.
    """
    if not require_approval:
        plan.status = "applied"
        return plan
    # Compute authority from the source kind. Fall back to 0.5 for unknown kinds.
    from ..retrieval.authority import SOURCE_AUTHORITY

    src_authority = SOURCE_AUTHORITY.get(source.get("kind", ""), 0.5)
    if plan.confidence >= confidence_threshold and src_authority >= authority_threshold:
        plan.status = "auto_approved"
    else:
        plan.status = "pending_approval"
    return plan


def load_pending(brain_root: Path) -> list[dict[str, Any]]:
    """Read the audit log; return entries whose plan is awaiting approval.

    An entry is considered pending if its embedded ``plan.status`` equals
    ``"pending_approval"`` and no later ``governance_decision`` entry has
    resolved its ``plan_id``. This keeps the CLI from re-prompting on
    plans that have already been approved or rejected.
    """
    log = AuditLog(brain_root)
    decided: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for entry in log.entries():
        kind = entry.get("kind")
        if kind == "governance_decision":
            pid = str(entry.get("plan_id", "")).strip()
            if pid:
                decided.add(pid)
            continue
        plan = entry.get("plan", {})
        if isinstance(plan, dict) and plan.get("status") == "pending_approval":
            candidates.append(entry)
    out: list[dict[str, Any]] = []
    for entry in candidates:
        plan = entry.get("plan", {}) or {}
        pid = str(plan.get("plan_id", "")).strip()
        if pid and pid in decided:
            continue
        out.append(entry)
    return out


def record_decision(
    brain_root: Path,
    plan_id: str,
    decision: str,
    approver: str,
    reason: str = "",
) -> None:
    """Append an approval or rejection record to the audit log.

    ``decision`` is expected to be ``"approved"`` or ``"rejected"``; we don't
    enforce a closed enum here because future workflows (``"deferred"``,
    ``"escalated"``) should be additive without a code change.
    """
    AuditLog(brain_root).append(
        {
            "kind": "governance_decision",
            "plan_id": plan_id,
            "decision": decision,
            "approver": approver,
            "reason": reason,
            "decided_at": time.time(),
        }
    )


def record_governance_tag(
    brain_root: Path,
    plan: ReconciliationPlan,
    source: dict[str, Any],
) -> None:
    """Persist the gated plan to the audit log under its ``plan_id``.

    The Reconciler already wrote a ``reconciliation_plan`` entry before the
    gate ran, so this is a *second* entry that captures the governance
    verdict. ``load_pending`` reads these entries to find work for human
    reviewers.
    """
    AuditLog(brain_root).append(
        {
            "kind": "governance_tag",
            "plan_id": plan.plan_id,
            "source": source,
            "plan": plan.to_dict(),
            "tagged_at": time.time(),
        }
    )


__all__ = [
    "DEFAULT_AUTHORITY_THRESHOLD",
    "DEFAULT_CONFIDENCE_THRESHOLD",
    "gate_plan",
    "load_pending",
    "make_plan_id",
    "record_decision",
    "record_governance_tag",
]
