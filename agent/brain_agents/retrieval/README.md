# Retrieval (Seat 1)

Two-stage semantic retrieval over a Markdown brain (`brian/` reference or
`brain/` working copy), with offline-safe fallbacks per ADR-0002.

## Layout

```
retrieval/
├── __init__.py     # exports Retriever, RetrievalHit
├── retriever.py    # two-stage pipeline + token packer
├── parser.py       # markdown -> Section (one per H2, plus #_intro)
├── encoder.py      # BGEEncoder (dense) + BM25Encoder (fallback)
├── reranker.py     # BGEReranker (cross-encoder) + KeywordReranker (fallback)
├── index.py        # incremental JSON cache at <root>/.index/sections.json
├── authority.py    # SOURCE_AUTHORITY weights (shared with update/)
└── README.md
```

## Public API (LOCKED — Seat 2 imports these)

```python
from agent.brain_agents.retrieval import Retriever, RetrievalHit

r = Retriever(brain_root=Path("brian"))         # builds/loads index, encoder, reranker
hits = r.query("constraints on user-service migration", top_k=5, token_budget=2000)
r.query_section_ids(["context/constraints.md#technical-constraints"])
r.all_sections()
```

`RetrievalHit` fields: `file_path, section_id, heading, content, dense_score,
rerank_score, tokens, frontmatter, source_kind`.

## Pipeline

1. **Index** (`build_index`) walks `*.md`, parses each file into one `Section`
   per H2 plus a synthetic `#_intro` section. The on-disk JSON cache is
   incremental: only files whose `mtime` changed are re-parsed.
2. **Stage 1 — Encoder.** Default: `BGEEncoder` (BAAI/bge-small-en-v1.5,
   384-dim, normalized cosine). Fallback: `BM25Encoder` (rank-bm25). Top 20
   sections advance.
3. **Stage 2 — Reranker.** Default: `BGEReranker`
   (BAAI/bge-reranker-base CrossEncoder). Fallback: `KeywordReranker`
   (stemmed Jaccard with heading boost).
4. **Authority blend.** A small (15%) multiplicative boost from
   `frontmatter.source.kind` via `SOURCE_AUTHORITY` so ADRs/merged PRs outrank
   ephemera when reranker scores tie.
5. **Token packing.** Greedy from the top under `token_budget` (tiktoken
   `cl100k_base`, 4-chars-per-token fallback). Sections under `context/` that
   made the shortlist are always added if they fit within ≤20% overshoot, so
   constraints/open-questions stay in the bundle even when relevance is close.

## Fallback behaviour (ADR-0002)

`make_encoder()` and `make_reranker()` try the BGE backends and silently fall
back to BM25 / keyword on any `ImportError`, missing model cache, or network
failure. `Retriever.backend_label` reports which is active:

```python
>>> Retriever(Path("brian")).backend_label
'encoder=bge-small-en-v1.5 (dense); reranker=bge-reranker-base (cross-encoder)'
```

When `~/.cache/huggingface` is removed and the network is offline:

```
encoder=bm25 (bm25); reranker=keyword (keyword)
```

## Performance

Measured on this repo (21 `.md` files, 94 sections) on a Windows 11 laptop,
CPU-only torch. Numbers come from `uv run python scripts/perf.py`.

| Step                                | Dense (BGE)              | Fallback (BM25 + keyword) |
| ----------------------------------- | ------------------------ | ------------------------- |
| Cold build (no caches)              | ~29s (model load + 94 encodes) | ~0.8s |
| Warm load (mtime + embedding cache) | ~0.03s in-process; ~5s cross-process (torch model load) | ~0.2s |
| Single query end-to-end             | 2.0–4.5s (cross-encoder dominates on CPU) | 3–4 ms |
| RSS after init + 1 query            | ~1.5 GiB (torch + 2 BGE models) | ~80 MiB |

Notes:

* The 500ms per-query target is achievable on GPU; on CPU the bge-reranker-base
  cross-encoder is the dominant cost (~80% of latency on 20 candidates with
  the 1.2k-char truncation we apply). The BM25+keyword fallback meets it
  comfortably.
* Embeddings are cached at `<root>/.index/embeddings.npz` keyed by a SHA-256
  fingerprint of (model name + corpus text). Any section edit invalidates the
  cache automatically.
* The 1 GiB memory target only holds for the fallback path; the dense path
  needs ~1.5 GiB because torch + two BGE models live in RAM. We trade memory
  for retrieval quality.

## Wiring

`tools.py` exposes two new tools that both use a lazy per-`brain_root`
singleton retriever (so the BGE model is only loaded once per process):

* `semantic_search(query, top_k=5)` — formatted markdown bundle.
* `get_brief(task, token_budget=2000)` — same, but token-budget aware.

Both are picked up by `build_reader_toolkit` automatically.
