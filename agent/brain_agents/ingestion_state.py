"""State schema for the explicit brain ingestion / update graph."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal, TypedDict

from .builder import DocumentInput, SourceDocument
from .config import Settings
from .update import ReconciliationPlan

FlowMode = Literal["initialize", "update"]


class IngestionState(TypedDict, total=False):
    """Merges across nodes; optional fields are set as the run progresses."""

    # --- Entry: always set for a run
    flow_mode: FlowMode
    settings: Settings
    # Initialize path
    document_inputs: list[DocumentInput]
    initial_prompt: str
    max_files: int
    overwrite: bool
    # Update path
    update_prompt: str
    source: dict[str, Any]
    update_mode: Literal["llm", "deterministic"]
    do_apply: bool

    # --- Working
    error: str | None
    normalized_docs: list[SourceDocument]
    cleaned_context: str
    # Update-only: pre-plan retrieval
    retrieval_hits: list[dict[str, Any]]
    candidate_files: list[str]
    plan: ReconciliationPlan | None
    # Initialize-only: written by bootstrap node
    written_map: dict[str, str]
    # Apply / verify
    applied_result_ops: int
    applied_files: list[str]
    # Final
    result_text: str
    # Verification snippet (for debugging / result_text)
    verify_line: str
    # Optional: bootstrap UI streams these as "thinking" lines (may be called from worker threads).
    progress_sink: Callable[[str], None]


__all__ = ["FlowMode", "IngestionState"]
