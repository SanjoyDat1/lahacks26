"""Verify the BM25 + keyword fallback path (ADR-0002).

We don't actually move the HuggingFace cache (intrusive on a shared machine);
instead we force the encoder/reranker selectors to skip the dense backends and
exercise the same code path the Retriever runs in offline mode.
"""

from __future__ import annotations

import time
from pathlib import Path

from brain_agents.retrieval import Retriever
from brain_agents.retrieval.encoder import BM25Encoder
from brain_agents.retrieval.reranker import KeywordReranker

REPO_ROOT = Path(__file__).resolve().parents[2]
BRAIN = REPO_ROOT / "brian"

QUERIES = [
    "What are the constraints on the user-service migration?",
    "Why did we choose markdown over a database?",
    "What's still undecided?",
]


def main() -> None:
    t0 = time.perf_counter()
    r = Retriever(brain_root=BRAIN, encoder=BM25Encoder(), reranker=KeywordReranker())
    print(f"backend: {r.backend_label}")
    print(f"index built in {time.perf_counter() - t0:.2f}s ({r.num_sections} sections)")
    for q in QUERIES:
        t0 = time.perf_counter()
        hits = r.query(q, top_k=3, token_budget=2000)
        dt = (time.perf_counter() - t0) * 1000
        print(f"\n--- ({dt:.0f} ms) {q}")
        for h in hits:
            print(f"   * {h.file_path} :: {h.heading}")


if __name__ == "__main__":
    main()
