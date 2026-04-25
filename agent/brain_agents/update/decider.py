"""Per-fact decision logic: given a Fact + retrieval hits, emit Operations.

This is the heart of the update pipeline. The decision tree is intentionally
written as plain Python (no LLM dependency in the default path) so that
ADR-0002 holds: an offline demo still produces sensible plans.

Decision tree per Fact
----------------------

1. **No related sections** -> ``append`` (or ``create_section`` if the default
   target file does not exist yet on disk).
2. **Related section CONTRADICTS the fact** -> two ``flag_conflict`` ops, one
   on the fact's natural target, one on the existing section. The conflict is
   left for human resolution.
3. **Related section CLEARLY SUPERSEDES** (same primary entity AND fact's
   source authority >= section's, AND fact is "newer" by signal) -> one
   ``supersede`` op against the existing section.
4. **Related section CONFIRMS / EXTENDS** (overlapping entities, no
   contradiction, similar polarity) -> one ``append`` op adding a date-stamped
   bullet to the related section.
5. **Already redundant** (high cosine + same type + entity overlap) -> one
   ``ignore`` op.

Authority weights come from
:mod:`agent.brain_agents.retrieval.authority`.

The optional LLM path (``use_llm=True``) only adjusts the contradiction check;
heuristic contradiction detection (negation flip on shared entities) is the
default and is good enough for the demo corpus.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from pathlib import Path
from typing import Any, Iterable, Sequence

from . import Operation
from .extractor import Fact

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Default routing per fact type
# ---------------------------------------------------------------------------

# Where a fact lands when nothing related already exists in the brain.
# "Failed Attempts" lives inside decision_log.md per shared context.
DEFAULT_TARGETS: dict[str, tuple[str, str | None]] = {
    "Decision": ("decisions/decision_log.md", None),
    "Constraint": ("context/constraints.md", None),
    "OpenQuestion": ("context/open_questions.md", None),
    "FailedAttempt": ("decisions/decision_log.md", "Failed Attempts"),
    "Convention": ("architecture/system_overview.md", "Conventions"),
}

# Cosine score above which we'll consider an existing section a near-duplicate.
REDUNDANT_DENSE_THRESHOLD = 0.92
# Rerank score above which we'll trust a section as strongly related.
STRONG_RERANK_THRESHOLD = 0.55
# A section qualifies as "really related" when it crosses BOTH thresholds:
#   * entity overlap is nonzero (the fact's curated entities appear in the
#     section), AND
#   * the cross-encoder gave it at least a soft positive score.
# When either is missing, we route the fact to its typed default file. This
# keeps semi-relevant cross-encoder scores from anchoring updates to the
# wrong section.
RELATEDNESS_OVERLAP_FLOOR = 0.10
RELATEDNESS_RERANK_FLOOR = 0.40
# Don't even consider a contradiction unless the candidate section is clearly
# about the same subject as the fact -- otherwise generic English words (e.g.
# "decision") create false positives against any section that happens to
# contain a negation token.
CONTRADICTION_OVERLAP_FLOOR = 0.30

# Negation tokens for contradiction heuristic.
_NEGATIONS = {"not", "no", "never", "without", "stop", "remove", "drop", "deprecate"}
# Antonym pairs we recognize for the polarity flip detector. Tuples are
# unordered: presence of either side counts.
_ANTONYMS: list[frozenset[str]] = [
    frozenset({"rest", "grpc"}),
    frozenset({"sync", "async"}),
    frozenset({"synchronous", "asynchronous"}),
    frozenset({"sql", "nosql"}),
    frozenset({"postgres", "mysql"}),
    frozenset({"queue", "synchronous"}),
    frozenset({"keep", "remove"}),
    frozenset({"add", "remove"}),
    frozenset({"enable", "disable"}),
]

# Coarse "newer" signal: a fact whose source authority strictly exceeds the
# section's authority by this delta is treated as a supersede candidate.
SUPERSEDE_AUTHORITY_DELTA = 0.05


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hit_attr(hit: Any, name: str, default: Any = None) -> Any:
    """Read a field from either a dataclass-like RetrievalHit or a dict."""
    if hasattr(hit, name):
        return getattr(hit, name)
    if isinstance(hit, dict):
        return hit.get(name, default)
    return default


# Local mirror of the locked SOURCE_AUTHORITY table. Used only when the shared
# retrieval module cannot be imported (e.g. while Seat 1's retriever.py is still
# being written). Keep in sync with agent/brain_agents/retrieval/authority.py.
_FALLBACK_AUTHORITY: dict[str, float] = {
    "merged_pr": 1.0,
    "adr": 1.0,
    "decision_log": 0.9,
    "manual": 0.95,
    "meeting": 0.8,
    "review_comment": 0.7,
    "issue": 0.6,
    "slack": 0.5,
    "demo": 0.4,
}
_FALLBACK_DEFAULT = 0.5


def _import_authority():
    """Return ``authority_for`` from retrieval; fall back to local mirror.

    The fallback exists so update/ can be developed and unit-tested before
    Seat 1's retriever.py exists. Once the retrieval package imports cleanly,
    we always use *its* table, which is the canonical source.
    """
    # Import the leaf module directly to avoid triggering retrieval/__init__.py
    # (which may eagerly import a not-yet-written retriever.py).
    try:
        import importlib

        mod = importlib.import_module("agent.brain_agents.retrieval.authority")
        return mod.authority_for  # type: ignore[attr-defined]
    except Exception:
        try:
            import importlib

            mod = importlib.import_module("brain_agents.retrieval.authority")
            return mod.authority_for  # type: ignore[attr-defined]
        except Exception:
            def _fallback(kind: str | None) -> float:
                if not kind:
                    return _FALLBACK_DEFAULT
                return _FALLBACK_AUTHORITY.get(kind.strip().lower(), _FALLBACK_DEFAULT)

            return _fallback


def _section_authority(hit: Any) -> float:
    src_kind = _hit_attr(hit, "source_kind", None)
    if not src_kind:
        fm = _hit_attr(hit, "frontmatter", {}) or {}
        if isinstance(fm, dict):
            src = fm.get("source")
            if isinstance(src, dict):
                src_kind = src.get("kind")
    return _import_authority()(src_kind)


def _tokenize(text: str) -> set[str]:
    if not text:
        return set()
    return {t for t in re.findall(r"[a-z0-9][a-z0-9\-]+", text.lower()) if len(t) > 1}


def _entity_overlap(fact: Fact, hit: Any) -> float:
    """Jaccard between fact entities and the hit's heading + body tokens."""
    if not fact.entities:
        return 0.0
    heading = _hit_attr(hit, "heading", "") or ""
    content = _hit_attr(hit, "content", "") or ""
    hit_tokens = _tokenize(f"{heading}\n{content}")
    if not hit_tokens:
        return 0.0
    fact_tokens = {e.lower() for e in fact.entities}
    overlap = fact_tokens & hit_tokens
    union = fact_tokens | hit_tokens
    if not union:
        return 0.0
    return len(overlap) / len(fact_tokens)  # asymmetric: how much of the fact is covered


def _has_negation_flip(
    fact_text: str,
    section_text: str,
    fact_entities: list[str],
) -> bool:
    """True if one side asserts X and the other asserts NOT X (heuristic).

    To avoid false positives like "the section heading says 'Decision' and
    the section body contains 'without'" we require the *shared subject* to
    come from the fact's curated entity list, not just any overlapping token.
    """
    s_tokens = _tokenize(section_text)
    f_words = fact_text.lower().split()
    s_words = section_text.lower().split()

    f_neg = any(w in _NEGATIONS for w in f_words)
    s_neg = any(w in _NEGATIONS for w in s_words)

    entity_set = {e.lower() for e in fact_entities}
    shared_subjects = entity_set & s_tokens
    if shared_subjects and (f_neg ^ s_neg):
        return True

    # Antonym pair: each side mentions the opposite of a known pair AND at
    # least one of the fact's entities is in the section (so the antonym is
    # *about* the same thing in both texts).
    if entity_set & s_tokens:
        f_tokens = _tokenize(fact_text)
        for pair in _ANTONYMS:
            f_side = pair & f_tokens
            s_side = pair & s_tokens
            if f_side and s_side and f_side != s_side:
                return True
    return False


def _llm_contradiction_check(fact: Fact, hit: Any, model: Any) -> bool | None:
    """Optional LLM polarity check. Returns ``None`` if the model is unavailable."""
    if model is None:
        return None
    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        section_text = f"## {_hit_attr(hit, 'heading', '')}\n{_hit_attr(hit, 'content', '')}"
        prompt = (
            "You compare a new fact against an existing brain section. "
            "Reply with EXACTLY one token: CONTRADICTS, CONFIRMS, EXTENDS, or UNRELATED."
        )
        user = (
            f"FACT ({fact.type}): {fact.content}\n\n"
            f"EXISTING SECTION:\n{section_text}\n\n"
            "Answer:"
        )
        resp = model.invoke([SystemMessage(content=prompt), HumanMessage(content=user)])
        text = (resp.content if hasattr(resp, "content") else str(resp))
        if isinstance(text, list):
            text = " ".join(str(t) for t in text)
        token = str(text).strip().split()[0].upper() if str(text).strip() else ""
        if token == "CONTRADICTS":
            return True
        if token in {"CONFIRMS", "EXTENDS", "UNRELATED"}:
            return False
        return None
    except Exception as exc:
        logger.debug("LLM contradiction check failed: %s", exc)
        return None


def _date_bullet(fact: Fact, source: dict[str, Any]) -> str:
    """Render a date-stamped Markdown bullet referencing the fact's source."""
    today = date.today().isoformat()
    kind = (source or {}).get("kind", "unknown")
    url = (source or {}).get("url", "")
    suffix = f" ([{kind}]({url}))" if url else f" _(source: {kind})_"
    return f"- {today}: {fact.content.rstrip('.')}.{suffix}"


def _new_section(fact: Fact, source: dict[str, Any]) -> str:
    """Render the body for a brand-new typed section."""
    today = date.today().isoformat()
    kind = (source or {}).get("kind", "unknown")
    url = (source or {}).get("url", "")
    src_line = f"_Source: [{kind}]({url}) on {today}_" if url else f"_Source: {kind} on {today}_"
    heading = _heading_for_fact(fact)
    return f"## {heading}\n\n{src_line}\n\n{fact.content.rstrip('.')}.\n"


def _heading_for_fact(fact: Fact) -> str:
    """Short heading derived from the fact (fallback uses its type)."""
    if fact.entities:
        primary = " / ".join(e.replace("-", " ").title() for e in fact.entities[:2])
        return f"{fact.type}: {primary}"
    text = re.sub(r"\s+", " ", fact.content).strip()
    if len(text) > 60:
        text = text[:60].rsplit(" ", 1)[0] + "..."
    return f"{fact.type}: {text}"


def _supersede_block(fact: Fact, hit: Any, source: dict[str, Any]) -> str:
    today = date.today().isoformat()
    kind = (source or {}).get("kind", "unknown")
    url = (source or {}).get("url", "")
    src_line = f"_Source: [{kind}]({url}) on {today}_" if url else f"_Source: {kind} on {today}_"
    old_id = _hit_attr(hit, "section_id", "") or ""
    return (
        f"<!-- status: superseded -->\n"
        f"_Superseded by update on {today}._\n\n"
        f"---\n\n"
        f"## {_heading_for_fact(fact)}\n\n"
        f"{src_line}\n\n"
        f"{fact.content.rstrip('.')}.\n\n"
        f"_Replaces previous section: `{old_id}`._\n"
    )


def _conflict_note(fact: Fact, hit: Any | None, source: dict[str, Any]) -> str:
    today = date.today().isoformat()
    other_id = _hit_attr(hit, "section_id", "(unknown)") if hit is not None else "(none)"
    kind = (source or {}).get("kind", "unknown")
    url = (source or {}).get("url", "")
    src = f"[{kind}]({url})" if url else kind
    return (
        f"> **CONFLICT ({today})**: {fact.content.rstrip('.')}.\n"
        f"> Source: {src}.\n"
        f"> Conflicts with `{other_id}`. Human resolution required."
    )


def _file_exists(brain_root: Path | None, rel_path: str) -> bool:
    if brain_root is None:
        return False
    return (brain_root / rel_path).is_file()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def decide_operations(
    fact: Fact,
    related: Sequence[Any],
    source: dict[str, Any] | None = None,
    *,
    brain_root: Path | None = None,
    llm_model: Any | None = None,
) -> list[Operation]:
    """Translate one ``Fact`` plus its related sections into ``Operation`` objects.

    Parameters
    ----------
    fact
        The atomic claim to reconcile.
    related
        Related ``RetrievalHit`` instances (or any duck-typed object exposing
        ``content``, ``heading``, ``section_id``, ``dense_score``,
        ``rerank_score``, optionally ``source_kind`` / ``frontmatter``).
        Pass an empty sequence to force the "no related" branch.
    source
        Source metadata for the *incoming* fact. ``{"kind": "meeting", ...}``.
    brain_root
        If provided, used to detect whether the default target file exists
        (so we can choose ``create_section`` vs ``append``).
    llm_model
        Optional chat model for the polarity check. If ``None`` we use
        heuristic contradiction detection.

    Returns
    -------
    list[Operation]
        Zero or more proposals. The reconciler stitches these into a
        :class:`ReconciliationPlan`.
    """
    src = source or {}
    default_file, default_section = DEFAULT_TARGETS.get(
        fact.type, ("decisions/decision_log.md", None)
    )

    related_list = list(related)

    def _no_related_route(reason_prefix: str) -> list[Operation]:
        if not _file_exists(brain_root, default_file):
            return [
                Operation(
                    kind="create_section",
                    target_file=default_file,
                    target_section_id=None,
                    new_content=_new_section(fact, src),
                    reason=(
                        f"{reason_prefix}; default target {default_file} "
                        f"does not exist yet -- creating typed section for {fact.type}."
                    ),
                )
            ]
        return [
            Operation(
                kind="append",
                target_file=default_file,
                target_section_id=(
                    f"{default_file}#{default_section.lower().replace(' ', '-')}"
                    if default_section
                    else None
                ),
                new_content=_date_bullet(fact, src),
                reason=(
                    f"{reason_prefix}; appending {fact.type} bullet to default "
                    f"target {default_file}."
                ),
            )
        ]

    if not related_list:
        return _no_related_route("No related sections")

    primary = related_list[0]
    primary_id = _hit_attr(primary, "section_id", "") or ""
    primary_file = _hit_attr(primary, "file_path", "") or default_file

    primary_dense = float(_hit_attr(primary, "dense_score", 0.0) or 0.0)
    primary_rerank = float(_hit_attr(primary, "rerank_score", 0.0) or 0.0)
    primary_content = _hit_attr(primary, "content", "") or ""
    primary_heading = _hit_attr(primary, "heading", "") or ""
    primary_text = f"{primary_heading}\n{primary_content}"

    overlap = _entity_overlap(fact, primary)

    # Relevance floor: a section only counts as a real anchor if it shares
    # entities with the fact *and* the reranker endorses it. Otherwise the
    # brain has no anchor for this fact and we route to the default typed
    # file. This prevents bolting updates onto cross-encoder false friends.
    if overlap < RELATEDNESS_OVERLAP_FLOOR or primary_rerank < RELATEDNESS_RERANK_FLOOR:
        return _no_related_route(
            f"Top related section `{primary_id}` is weakly relevant "
            f"(overlap={overlap:.2f}, rerank={primary_rerank:.2f})"
        )

    # 1. Contradiction (heuristic, then optional LLM confirm). Skip when the
    #    fact and section don't even share enough subject matter -- otherwise
    #    a generic negation token in the section creates a phantom conflict.
    contradiction = False
    if overlap >= CONTRADICTION_OVERLAP_FLOOR:
        contradiction = _has_negation_flip(
            fact.content, primary_text, fact.entities
        )
        if not contradiction and llm_model is not None:
            llm_verdict = _llm_contradiction_check(fact, primary, llm_model)
            if llm_verdict is True:
                contradiction = True
    if contradiction:
        return [
            Operation(
                kind="flag_conflict",
                target_file=primary_file,
                target_section_id=primary_id,
                new_content=_conflict_note(fact, primary, src),
                reason=(
                    f"Incoming {fact.type} contradicts existing section "
                    f"`{primary_id}` (negation/antonym flip on shared entities)."
                ),
            ),
            Operation(
                kind="flag_conflict",
                target_file=default_file,
                target_section_id=None,
                new_content=_conflict_note(fact, primary, src),
                reason=(
                    "Mirrored conflict marker on the typed default file so the "
                    "conflict is discoverable from both sides."
                ),
            ),
        ]

    # 2. Redundant (very strong dense + high overlap + same type bucket).
    if primary_dense >= REDUNDANT_DENSE_THRESHOLD and overlap >= 0.5:
        return [
            Operation(
                kind="ignore",
                target_file=primary_file,
                target_section_id=primary_id,
                new_content="",
                reason=(
                    f"Fact is semantically redundant with `{primary_id}` "
                    f"(dense={primary_dense:.2f}, overlap={overlap:.2f})."
                ),
            )
        ]

    # 3. Supersede: same entity, fact's authority dominates, signal is strong.
    fact_authority = _import_authority()(src.get("kind"))
    section_authority = _section_authority(primary)
    if (
        overlap >= 0.5
        and primary_rerank >= STRONG_RERANK_THRESHOLD
        and fact_authority - section_authority >= SUPERSEDE_AUTHORITY_DELTA
        and fact.type in {"Decision", "Constraint"}
    ):
        return [
            Operation(
                kind="supersede",
                target_file=primary_file,
                target_section_id=primary_id,
                new_content=_supersede_block(fact, primary, src),
                reason=(
                    f"Same entity ({sorted(fact.entities)[:3]}) and incoming "
                    f"source authority {fact_authority:.2f} exceeds existing "
                    f"section authority {section_authority:.2f}; superseding."
                ),
            )
        ]

    # 4. Default: confirms / extends -> append a date-stamped bullet.
    return [
        Operation(
            kind="append",
            target_file=primary_file,
            target_section_id=primary_id,
            new_content=_date_bullet(fact, src),
            reason=(
                f"Related to `{primary_id}` "
                f"(rerank={primary_rerank:.2f}, overlap={overlap:.2f}); "
                f"appending dated bullet."
            ),
        )
    ]


__all__ = [
    "decide_operations",
    "DEFAULT_TARGETS",
    "REDUNDANT_DENSE_THRESHOLD",
    "STRONG_RERANK_THRESHOLD",
]
