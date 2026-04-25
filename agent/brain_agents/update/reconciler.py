"""Top-level orchestrator: incoming text -> ``ReconciliationPlan``.

Pipeline (per ``reconcile`` call):

1. :func:`extractor.extract_facts` -> list[Fact]
2. For every fact, ``retriever.query(fact.content, top_k=3, token_budget=500)``
   to find the related sections.
3. For every fact, :func:`decider.decide_operations` -> list[Operation].
4. Stitch into one :class:`ReconciliationPlan` (joint rationale, average
   confidence, deduped related-section ids).
5. Persist the plan to ``<brain_root>/.audit/log.jsonl`` via :class:`AuditLog`.

The retriever is dependency-injected so tests can stub it. We deliberately
type the parameter as a :class:`Protocol` rather than importing
``Retriever`` so that ``update`` does not hard-import ``retrieval``; this
keeps Phase-1 development unblocked while Seat 1 finishes their module.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Sequence, runtime_checkable

from . import Operation, ReconciliationPlan
from .audit import AuditLog
from .decider import decide_operations
from .extractor import Fact, extract_facts

logger = logging.getLogger(__name__)


@runtime_checkable
class RetrieverLike(Protocol):
    """Subset of ``retrieval.Retriever`` we depend on.

    Defined as a Protocol so ``update`` can be tested with a fake retriever
    and so the package import does not fail when retrieval is mid-build.
    """

    def query(self, text: str, top_k: int = ..., token_budget: int = ...) -> list[Any]: ...


def _safe_brain_root(retriever: Any) -> Path:
    """Best-effort: pull ``brain_root`` off the retriever, else cwd."""
    root = getattr(retriever, "brain_root", None)
    if root is None:
        return Path.cwd()
    return Path(root).resolve()


def _build_chat_model_optional() -> Any | None:
    """Build the shared chat model if a key is configured; otherwise None."""
    try:
        from ..config import load_settings
        from ..llm import make_chat_model
    except Exception as exc:  # pragma: no cover
        logger.debug("LLM imports unavailable: %s", exc)
        return None
    try:
        settings = load_settings(validate=False)
        api_key = (
            getattr(settings, "gemini_api_key", "")
            or getattr(settings, "google_api_key", "")
            or getattr(settings, "openrouter_api_key", "")
            or ""
        )
        if not str(api_key).strip():
            return None
        return make_chat_model(settings)
    except Exception as exc:
        logger.debug("Could not build chat model: %s", exc)
        return None


class Reconciler:
    """Reconcile incoming context against a working brain.

    Parameters
    ----------
    retriever
        Anything matching :class:`RetrieverLike`. In production this is the
        real ``agent.brain_agents.retrieval.Retriever`` instance.
    audit_log
        Optional preconstructed :class:`AuditLog`. When omitted we derive the
        path from ``retriever.brain_root``. Pass ``audit_log=False`` to
        disable persistence (useful for unit tests).
    use_llm
        Force LLM-on or LLM-off for *both* extraction and contradiction
        checking. Default ``"auto"``: use LLM when an API key is configured,
        heuristics otherwise.
    """

    def __init__(
        self,
        retriever: RetrieverLike,
        *,
        audit_log: AuditLog | bool | None = None,
        use_llm: bool | str = "auto",
    ) -> None:
        self.retriever = retriever
        self.brain_root: Path = _safe_brain_root(retriever)

        if audit_log is False:
            self.audit_log: AuditLog | None = None
        elif isinstance(audit_log, AuditLog):
            self.audit_log = audit_log
        else:
            self.audit_log = AuditLog(self.brain_root)

        self._use_llm: bool | str = use_llm
        self._chat_model: Any | None = self._maybe_build_model()

    def _maybe_build_model(self) -> Any | None:
        if self._use_llm is False:
            return None
        return _build_chat_model_optional()

    @property
    def llm_enabled(self) -> bool:
        return self._chat_model is not None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reconcile(
        self, incoming_text: str, source: dict[str, Any] | None = None
    ) -> ReconciliationPlan:
        """Build (and persist) a :class:`ReconciliationPlan` for one input.

        The plan is *always* appended to the audit log before being returned,
        so even a no-op (empty operations) is recorded.
        """
        src = source or {}
        extract_mode = "auto" if self._use_llm != False else "heuristic"  # noqa: E712
        facts = extract_facts(incoming_text, src, mode=extract_mode)  # type: ignore[arg-type]

        if not facts:
            plan = ReconciliationPlan(
                operations=[],
                rationale="No durable facts extracted from the incoming text.",
                related_sections=[],
                confidence=0.0,
            )
            self._persist(plan, incoming_text=incoming_text, source=src, facts=[])
            return plan

        all_ops: list[Operation] = []
        related_ids: list[str] = []
        rationales: list[str] = []
        confidences: list[float] = []

        for fact in facts:
            related = self._safe_query(fact.content)
            for hit in related:
                sid = self._hit_id(hit)
                if sid and sid not in related_ids:
                    related_ids.append(sid)

            ops = decide_operations(
                fact,
                related,
                src,
                brain_root=self.brain_root,
                llm_model=self._chat_model,
            )
            all_ops.extend(ops)
            confidences.append(fact.confidence)
            rationales.append(self._fact_rationale(fact, ops))

        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
        joint_rationale = self._join_rationale(facts, rationales, all_ops)

        plan = ReconciliationPlan(
            operations=all_ops,
            rationale=joint_rationale,
            related_sections=related_ids,
            confidence=round(avg_conf, 4),
        )
        self._persist(plan, incoming_text=incoming_text, source=src, facts=facts)
        return plan

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _safe_query(self, text: str) -> list[Any]:
        try:
            return list(self.retriever.query(text, top_k=3, token_budget=500))
        except Exception as exc:
            logger.warning("retriever.query failed (%s); treating as no related sections", exc)
            return []

    @staticmethod
    def _hit_id(hit: Any) -> str:
        sid = getattr(hit, "section_id", None)
        if sid:
            return str(sid)
        if isinstance(hit, dict):
            return str(hit.get("section_id", "")) or ""
        return ""

    @staticmethod
    def _fact_rationale(fact: Fact, ops: Sequence[Operation]) -> str:
        kinds = ", ".join(op.kind for op in ops) if ops else "no-op"
        return f"{fact.type} (conf={fact.confidence:.2f}) -> {kinds}"

    @staticmethod
    def _join_rationale(
        facts: Sequence[Fact],
        per_fact: Sequence[str],
        ops: Sequence[Operation],
    ) -> str:
        header = f"Extracted {len(facts)} fact(s); proposed {len(ops)} operation(s)."
        bullets = "\n".join(f"- {line}" for line in per_fact)
        return f"{header}\n{bullets}" if bullets else header

    def _persist(
        self,
        plan: ReconciliationPlan,
        *,
        incoming_text: str,
        source: dict[str, Any],
        facts: Sequence[Fact],
    ) -> None:
        if self.audit_log is None:
            return
        try:
            entry = {
                "kind": "reconciliation_plan",
                "incoming_text_preview": incoming_text[:500],
                "source": source,
                "facts": [f.to_dict() for f in facts],
                "plan": plan.to_dict(),
                "llm_enabled": self.llm_enabled,
            }
            self.audit_log.append(entry)
        except Exception as exc:  # never let logging break the agent
            logger.warning("Failed to append audit entry: %s", exc)


__all__ = ["Reconciler", "RetrieverLike"]
