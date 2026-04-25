"""15-query retrieval eval harness.

Spans five query patterns: literal, paraphrased, conceptual, entity-specific,
and adversarial (out-of-distribution). Each query carries an ``expected``
string naming the file(s) whose section ought to surface in the top hits.

The ``QUERIES`` constant is module-level so other tools (e.g.
``scripts/benchmark.py``) can import it without re-running the harness.

Run as a script from the ``agent/`` directory::

    uv run python scripts/eval.py
"""

from __future__ import annotations

import time
from pathlib import Path

# 15 queries spanning literal, paraphrased, conceptual, and entity-specific
# patterns. Each tagged with "expected" file(s) for sanity-eyeballing and for
# the recall metrics computed downstream. The "expected" string uses
# ``" or "`` to separate alternatives, which the benchmark splits on for the
# lenient recall calculation.
QUERIES: list[tuple[str, str]] = [
    # --- Literal / verbatim phrasing (should score very high) ---
    ("Use GitHub-Backed Markdown As The Production Brain", "decisions/ADR-0001"),
    ("Important Failure Behavior", "architecture/runtime_flow"),
    ("Significance Criteria", "architecture/distillation_pipeline"),

    # --- Paraphrased natural language (real-world judge style) ---
    ("Why did we choose markdown over a database?", "decisions/ADR-0001"),
    ("What are the open questions in the project?", "context/open_questions"),
    ("How does the system handle missing API credentials?", "decisions/ADR-0002 or runtime_flow"),
    ("What database does production use?", "architecture/data_model or context/constraints"),
    ("How are Slack messages ingested?", "integrations/slack"),

    # --- Conceptual / abstract ---
    ("What is the high-level architecture of this system?", "architecture/system_overview"),
    ("How is the brain stored?", "architecture/brain_storage"),
    ("What gets logged when a webhook fires?", "architecture/runtime_flow or ingestion_pipeline"),

    # --- Entity-specific ---
    ("pgvector embeddings", "architecture/data_model"),
    ("OpenAI integration", "architecture/system_overview or distillation_pipeline"),
    ("meeting transcripts", "integrations/meetings"),

    # --- Adversarial / out-of-distribution (should score low across the board) ---
    ("How do I bake chocolate chip cookies?", "NOTHING - should rank weakly"),
]

# Backwards-compatible alias used by older callers.
queries = QUERIES

REPO_ROOT = Path(__file__).resolve().parents[2]
BRAIN = REPO_ROOT / "brian"


def main() -> None:
    # Local import keeps ``from scripts.eval import QUERIES`` cheap for
    # importers that don't want to construct a Retriever.
    from brain_agents.retrieval import Retriever

    print("=== Cold start ===")
    t0 = time.perf_counter()
    r = Retriever(brain_root=BRAIN)
    init_ms = (time.perf_counter() - t0) * 1000
    print(f"Retriever init: {init_ms:.0f} ms ({r.backend_label})")
    print()

    print("=== Per-query results ===")
    print()

    total_warm = 0.0
    for i, (q, expected) in enumerate(QUERIES, 1):
        t0 = time.perf_counter()
        hits = r.query(q, top_k=3)
        dt_ms = (time.perf_counter() - t0) * 1000
        total_warm += dt_ms

        print(f'[{i:2d}] ({dt_ms:5.0f} ms)  "{q}"')
        print(f"     expected: {expected}")
        for h in hits:
            marker = "  *" if h is hits[0] else "   "
            print(
                f"  {marker} rerank={h.rerank_score:.3f} dense={h.dense_score:.3f}  "
                f"{h.file_path}#{h.heading[:40]}"
            )
        print()

    print("=" * 70)
    print(f"Mean per-query: {total_warm / len(QUERIES):.0f} ms")
    print(f"Total wall: {total_warm:.0f} ms across {len(QUERIES)} queries")


if __name__ == "__main__":
    main()
