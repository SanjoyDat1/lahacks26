"""Three-model encoder bake-off on the retrieval module.

Compares the current default (``BAAI/bge-small-en-v1.5``) against two other
``sentence-transformers``-loadable models on the existing 15-query eval set.
The reranker is held constant (BGE-reranker-base) across all runs — this is
deliberately an *encoder-only* comparison.

For each model we measure:

* Cold start time (with ``brian/.index`` wiped clean — model load + section
  parse + full corpus encode)
* Warm load time (cache hit on ``sections.json`` + ``embeddings.npz``)
* Per-query end-to-end latency (mean over 15 warm queries)
* Recall@1 strict (top-1 hit matches the *primary* expected file)
* Recall@1 lenient (top-1 hit matches *any* of the ``" or "`` alternatives)
* Recall@3 (any of top-3 hits matches the primary expected file)

Adversarial / out-of-distribution queries (``"NOTHING - should rank weakly"``)
are excluded from the recall denominators.

Run from the ``agent/`` directory::

    uv run python scripts/benchmark.py

Output is printed to stdout *and* written to ``scripts/benchmark-results.md``.
"""

from __future__ import annotations

import gc
import shutil
import sys
import time
import traceback
from pathlib import Path
from typing import Any

# Make ``from scripts.eval import QUERIES`` work when running as
# ``python scripts/benchmark.py`` from the ``agent/`` directory.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR.parent))

from brain_agents.retrieval import Retriever
from brain_agents.retrieval.encoder import BGEEncoder, _ST_MODEL_CACHE
from brain_agents.retrieval.index import INDEX_DIRNAME
from scripts.eval import QUERIES  # noqa: E402  (reuse, do not duplicate)

REPO_ROOT = Path(__file__).resolve().parents[2]
BRAIN = REPO_ROOT / "brian"
RESULTS_PATH = _THIS_DIR / "benchmark-results.md"

MODELS: list[str] = [
    "BAAI/bge-small-en-v1.5",          # current baseline (384-dim)
    "maidalun1020/bce-embedding-base_v1",  # NetEase BCE (768-dim)
    "intfloat/e5-small-v2",            # Microsoft E5 (384-dim)
]

# Marker used in eval.py for adversarial queries — excluded from recall denom.
_ADVERSARIAL_MARKER = "NOTHING"


# ---------------------------------------------------------------------------
# Cache hygiene
# ---------------------------------------------------------------------------


def _wipe_index() -> None:
    """Remove the on-disk index dir so the next Retriever build is cold.

    Wipes both ``sections.json`` and ``embeddings.npz`` — the user's spec is
    explicit about a fresh rebuild per model so cold-start numbers are
    apples-to-apples.
    """
    p = BRAIN / INDEX_DIRNAME
    if p.exists():
        shutil.rmtree(p)


def _drop_st_model_cache() -> None:
    """Evict every cached sentence-transformers model from memory.

    Without this the second/third model in the run would skip the in-process
    model-load step that the first one paid for, masking real cold-start cost.
    """
    _ST_MODEL_CACHE.clear()
    gc.collect()


# ---------------------------------------------------------------------------
# Recall scoring
# ---------------------------------------------------------------------------


def _normalize_path(p: str) -> str:
    return p.lower().replace("\\", "/")


def _is_adversarial(expected: str) -> bool:
    return _ADVERSARIAL_MARKER in expected


def _expected_alternatives(expected: str) -> list[str]:
    """Split ``"a or b"`` style strings into normalized stems."""
    if _is_adversarial(expected):
        return []
    return [_normalize_path(p.strip()) for p in expected.split(" or ") if p.strip()]


def _hit_matches(file_path: str, stem: str) -> bool:
    """Substring-on-normalized-path match.

    The eval ``expected`` field uses short stems like ``"decisions/ADR-0001"``;
    the actual file paths look like ``"decisions/ADR-0001-git-backed-brain.md"``.
    A normalized substring check is the simplest defensible matcher.
    """
    return stem in _normalize_path(file_path)


# ---------------------------------------------------------------------------
# Per-model benchmark
# ---------------------------------------------------------------------------


def _run_queries(r: Retriever) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for q, expected in QUERIES:
        t0 = time.perf_counter()
        hits = r.query(q, top_k=3)
        dt_ms = (time.perf_counter() - t0) * 1000
        out.append(
            {
                "query": q,
                "expected": expected,
                "latency_ms": dt_ms,
                "hits": [
                    {
                        "file_path": h.file_path,
                        "heading": h.heading,
                        "dense_score": float(h.dense_score),
                        "rerank_score": float(h.rerank_score),
                    }
                    for h in hits
                ],
            }
        )
    return out


def _compute_recall(per_query: list[dict[str, Any]]) -> dict[str, Any]:
    """Recall metrics (adversarial query excluded from denominator).

    * **r1_strict**  — top-1 file path contains the *primary* expected stem
      (the first ``" or "``-separated alternative).
    * **r1_lenient** — top-1 file path contains *any* alternative.
    * **r3**         — any of the top-3 file paths contains *any* alternative.

    Matching alternatives (rather than only the primary) for ``recall@3``
    aligns with how the original eval.py harness was eyeball-scored — a hit
    on either named alternative was counted as "found".
    """
    n_total = sum(1 for e in per_query if not _is_adversarial(e["expected"]))
    r1_strict = r1_lenient = r3 = 0
    misses_strict: list[str] = []
    for entry in per_query:
        alts = _expected_alternatives(entry["expected"])
        if not alts:
            continue
        primary = alts[0]
        hit_paths = [h["file_path"] for h in entry["hits"]]
        top1 = hit_paths[0] if hit_paths else ""
        if top1 and _hit_matches(top1, primary):
            r1_strict += 1
        else:
            misses_strict.append(entry["query"])
        if any(_hit_matches(hp, a) for hp in hit_paths for a in alts):
            r3 += 1
        if top1 and any(_hit_matches(top1, a) for a in alts):
            r1_lenient += 1
    return {
        "n": n_total,
        "r1_strict": r1_strict,
        "r1_lenient": r1_lenient,
        "r3": r3,
        "misses_strict": misses_strict,
    }


def benchmark_model(model_name: str) -> dict[str, Any]:
    """Run the full cold/warm/queries cycle for one model."""
    print(f"\n{'=' * 72}\n[bench] {model_name}\n{'=' * 72}", flush=True)

    _wipe_index()
    _drop_st_model_cache()
    gc.collect()

    # Cold start: model load (from HF cache) + section parse + corpus encode.
    t0 = time.perf_counter()
    encoder = BGEEncoder(model_name=model_name)
    r = Retriever(brain_root=BRAIN, encoder=encoder)
    cold_s = time.perf_counter() - t0
    print(
        f"  cold start: {cold_s:.2f}s  "
        f"({r.num_sections} sections; {r.backend_label})",
        flush=True,
    )

    # Warm queries.
    print(f"  running {len(QUERIES)} warm queries...", flush=True)
    per_query = _run_queries(r)
    mean_q_ms = sum(e["latency_ms"] for e in per_query) / max(1, len(per_query))
    print(f"  mean per-query: {mean_q_ms:.0f} ms", flush=True)

    # Warm load: drop the Retriever and rebuild against the populated cache.
    del r, encoder
    gc.collect()
    t0 = time.perf_counter()
    encoder = BGEEncoder(model_name=model_name)
    r2 = Retriever(brain_root=BRAIN, encoder=encoder)
    warm_s = time.perf_counter() - t0
    print(f"  warm load : {warm_s:.2f}s", flush=True)

    recall = _compute_recall(per_query)
    print(
        f"  recall@1 strict={recall['r1_strict']}/{recall['n']}  "
        f"recall@3={recall['r3']}/{recall['n']}  "
        f"recall@1 lenient={recall['r1_lenient']}/{recall['n']}",
        flush=True,
    )

    del r2, encoder
    gc.collect()

    return {
        "model": model_name,
        "name": model_name.split("/")[-1],
        "cold_s": cold_s,
        "warm_s": warm_s,
        "mean_query_ms": mean_q_ms,
        "per_query": per_query,
        "recall": recall,
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _summary_table(results: list[dict[str, Any]]) -> str:
    header = (
        "| Model | Cold start (s) | Warm load (s) | Mean query (ms) | "
        "Recall@1 strict | Recall@3 | Recall@1 lenient |\n"
        "|---|---|---|---|---|---|---|"
    )
    rows: list[str] = []
    for res in results:
        if "error" in res:
            rows.append(f"| `{res['name']}` | ERROR: {res['error']} | | | | | |")
            continue
        rec = res["recall"]
        rows.append(
            f"| `{res['name']}` | {res['cold_s']:.2f} | {res['warm_s']:.2f} | "
            f"{res['mean_query_ms']:.0f} | "
            f"{rec['r1_strict']}/{rec['n']} | "
            f"{rec['r3']}/{rec['n']} | "
            f"{rec['r1_lenient']}/{rec['n']} |"
        )
    return header + "\n" + "\n".join(rows)


def _disagreement_section(results: list[dict[str, Any]]) -> str:
    """For each non-baseline model, list queries where its top-1 disagreed
    with the baseline (BGE-small) — the most interesting Q&A material.
    """
    valid = [r for r in results if "error" not in r]
    if len(valid) < 2:
        return ""
    baseline = valid[0]
    base_top1 = {
        e["query"]: (e["hits"][0]["file_path"] if e["hits"] else "")
        for e in baseline["per_query"]
    }
    out = ["## Disagreements vs. BGE-small baseline\n"]
    for res in valid[1:]:
        diffs: list[tuple[str, str, str]] = []
        for entry in res["per_query"]:
            this_top = entry["hits"][0]["file_path"] if entry["hits"] else ""
            base = base_top1.get(entry["query"], "")
            if this_top != base:
                diffs.append((entry["query"], base, this_top))
        out.append(f"### `{res['name']}` ({len(diffs)} top-1 disagreements)\n")
        if not diffs:
            out.append("_No top-1 disagreements vs baseline._\n")
            continue
        out.append("| Query | BGE-small top-1 | This model top-1 |")
        out.append("|---|---|---|")
        for q, base, this in diffs:
            out.append(
                f"| {q} | `{base or '—'}` | `{this or '—'}` |"
            )
        out.append("")
    return "\n".join(out)


def _per_query_breakdown(results: list[dict[str, Any]]) -> str:
    out = ["## Per-query top-3 by model\n"]
    for res in results:
        out.append(f"### `{res['name']}`\n")
        if "error" in res:
            out.append(f"_Run failed: {res['error']}_\n")
            continue
        for i, entry in enumerate(res["per_query"], 1):
            out.append(
                f"**{i:02d}. ({entry['latency_ms']:.0f} ms)** "
                f"`{entry['query']}`  \n  "
                f"_expected:_ `{entry['expected']}`"
            )
            for h in entry["hits"]:
                out.append(
                    f"  - rerank=`{h['rerank_score']:.3f}` "
                    f"dense=`{h['dense_score']:.3f}`  "
                    f"`{h['file_path']}` :: {h['heading']}"
                )
            out.append("")
    return "\n".join(out)


def write_report(results: list[dict[str, Any]]) -> None:
    parts = [
        "# Retrieval encoder bake-off\n",
        f"_Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}_  ",
        f"_Brain: `{BRAIN.relative_to(REPO_ROOT).as_posix()}` "
        f"({len(QUERIES)} queries; BGE-reranker-base held constant across all runs)_\n",
        "## Summary\n",
        _summary_table(results),
        "",
        "**Recall denominators exclude the 1 adversarial / out-of-distribution "
        "query (15 - 1 = 14).**  \n"
        "* `Recall@1 strict`  — top-1 file path contains the **primary** expected stem.  \n"
        "* `Recall@3`         — any of the top-3 file paths contains **any** "
        '`" or "`-separated alternative.  \n'
        "* `Recall@1 lenient` — top-1 file path contains **any** alternative.\n",
        _disagreement_section(results),
        _per_query_breakdown(results),
    ]
    RESULTS_PATH.write_text("\n".join(parts), encoding="utf-8")
    print(f"\n[bench] wrote {RESULTS_PATH.relative_to(REPO_ROOT)}", flush=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    print(f"[bench] brain_root = {BRAIN}", flush=True)
    print(f"[bench] models     = {MODELS}", flush=True)
    print(f"[bench] queries    = {len(QUERIES)} (from scripts.eval.QUERIES)", flush=True)

    results: list[dict[str, Any]] = []
    for m in MODELS:
        try:
            results.append(benchmark_model(m))
        except Exception as e:  # keep going so partial reports still get written
            traceback.print_exc()
            results.append(
                {"model": m, "name": m.split("/")[-1], "error": f"{type(e).__name__}: {e}"}
            )

    print("\n" + "=" * 72)
    print("Final summary (also written to scripts/benchmark-results.md):")
    print("=" * 72)
    print(_summary_table(results))

    write_report(results)


if __name__ == "__main__":
    main()
