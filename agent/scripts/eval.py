import time
from pathlib import Path
from agent.brain_agents.retrieval import Retriever

# 15 queries spanning literal, paraphrased, conceptual, and entity-specific patterns.
# Each tagged with "expected" file(s) for sanity-eyeballing.
queries = [
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

print('=== Cold start ===')
t0 = time.perf_counter()
r = Retriever(brain_root=Path('brian'))
init_ms = (time.perf_counter() - t0) * 1000
print(f'Retriever init: {init_ms:.0f} ms')
print()

print('=== Per-query results ===')
print()

total_warm = 0.0
correct_top1 = 0
for i, (q, expected) in enumerate(queries, 1):
    t0 = time.perf_counter()
    hits = r.query(q, top_k=3)
    dt_ms = (time.perf_counter() - t0) * 1000
    total_warm += dt_ms

    print(f'[{i:2d}] ({dt_ms:5.0f} ms)  "{q}"')
    print(f'     expected: {expected}')
    for h in hits:
        marker = '  *' if h is hits[0] else '   '
        print(f'  {marker} rerank={h.rerank_score:.3f} dense={h.dense_score:.3f}  {h.file_path}#{h.heading[:40]}')
    print()

print('=' * 70)
print(f'Mean per-query: {total_warm/len(queries):.0f} ms')
print(f'Total wall: {total_warm:.0f} ms across {len(queries)} queries')
