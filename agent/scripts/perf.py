"""Tiny perf + smoke harness for the retrieval module.

Run from the ``agent/`` directory::

    uv run python scripts/perf.py

It prints:
  * Cold build time (rebuild from scratch, no cache)
  * Warm load time (cache hit)
  * Per-query end-to-end latency
  * Top-3 hits for each of the three demo queries
  * Resident memory (best-effort, falls back to None)
"""

from __future__ import annotations

import gc
import os
import shutil
import time
from pathlib import Path

from brain_agents.retrieval import Retriever
from brain_agents.retrieval.index import INDEX_DIRNAME

REPO_ROOT = Path(__file__).resolve().parents[2]
BRAIN = REPO_ROOT / "brian"

DEMO_QUERIES = [
    "What are the constraints on the user-service migration?",
    "Why did we choose markdown over a database?",
    "What's still undecided?",
]


def _rss_mb() -> float | None:
    try:
        import psutil  # type: ignore

        return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except Exception:
        return None


def _wipe_cache() -> None:
    p = BRAIN / INDEX_DIRNAME
    if p.exists():
        shutil.rmtree(p)


def main() -> None:
    print(f"brain_root = {BRAIN}")
    _wipe_cache()
    gc.collect()

    t0 = time.perf_counter()
    r = Retriever(brain_root=BRAIN)
    cold = time.perf_counter() - t0
    print(f"cold build : {cold:.2f}s   ({r.num_sections} sections; {r.backend_label})")

    del r
    gc.collect()
    t0 = time.perf_counter()
    r = Retriever(brain_root=BRAIN)
    warm = time.perf_counter() - t0
    print(f"warm load  : {warm:.2f}s")

    rss = _rss_mb()
    if rss is not None:
        print(f"rss        : {rss:.0f} MiB")

    print()
    for q in DEMO_QUERIES:
        t0 = time.perf_counter()
        hits = r.query(q, top_k=3, token_budget=2000)
        dt = (time.perf_counter() - t0) * 1000
        print(f"--- query ({dt:.0f} ms): {q}")
        for h in hits:
            print(
                f"   * {h.file_path}#{h.heading.lower().replace(' ', '-')}  "
                f"rerank={h.rerank_score:.3f} dense={h.dense_score:.3f}"
            )
        print()


if __name__ == "__main__":
    main()
