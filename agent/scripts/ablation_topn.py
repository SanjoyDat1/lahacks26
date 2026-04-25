"""Rerank-shortlist (topN) ablation across 3 encoders.

Single-parameter sweep: ``_STAGE1_TOPN`` ∈ {4, 8, 12, 16, 20, 30} held against
the existing 3 encoders (BGE-small / BCE / E5-small). Reranker, corpus, and
query set are constant.

Per ``(encoder, topN)``:

* **Quality** — one deterministic run of the 15 eval queries → recall@1 strict,
  recall@3, recall@1 lenient, plus per-query top-3 hits.
* **Latency** — 5 repeated runs of all 15 queries; per-rep mean latency is
  aggregated to ``mean / median / min-max`` across the 5 reps. Reps run *in
  series* — parallelism would invalidate the latency comparison.

Cold start is measured **once per encoder** (3 numbers total). It's
encoder-load-bound, not topN-bound, so we cache the encoder + index across the
6 topN values within an encoder run and only wipe ``brian/.index`` between
encoder changes.

The shortlist size is injected at runtime by mutating
``brain_agents.retrieval.retriever._STAGE1_TOPN`` between configs.
``retriever.py`` is **never** modified by this script — production default
stays exactly where it is unless a separate decision says to ship a change.

Partial-write safety: ``ablation-results.md`` is rewritten after every
``(encoder, topN)`` cell completes, so killing the process never loses more
than one cell of work. There is also a 2.5-hour hard ceiling that aborts
gracefully and writes a partial report.

Run from the ``agent/`` directory::

    uv run python scripts/ablation_topn.py
"""

from __future__ import annotations

import gc
import shutil
import statistics
import sys
import time
import traceback
from pathlib import Path
from typing import Any

# Make ``from scripts.eval import QUERIES`` work when running as
# ``python scripts/ablation_topn.py`` from the ``agent/`` directory.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR.parent) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR.parent))

from brain_agents.retrieval import Retriever
from brain_agents.retrieval.encoder import BGEEncoder, _ST_MODEL_CACHE
from brain_agents.retrieval.index import INDEX_DIRNAME
from brain_agents.retrieval import retriever as retriever_mod
from scripts.eval import QUERIES  # noqa: E402  (reuse, do not duplicate)

REPO_ROOT = Path(__file__).resolve().parents[2]
BRAIN = REPO_ROOT / "brian"
RESULTS_PATH = _THIS_DIR / "ablation-results.md"

ENCODERS: list[str] = [
    "BAAI/bge-small-en-v1.5",          # production primary; headline row
    "maidalun1020/bce-embedding-base_v1",  # cross-validation #1
    "intfloat/e5-small-v2",            # cross-validation #2
]

TOP_NS: list[int] = [4, 8, 12, 16, 20, 30]
LATENCY_REPS: int = 5

# Headline encoder gets the dedicated table + the disagreement section.
HEADLINE_ENCODER = "BAAI/bge-small-en-v1.5"

# 2.5 h hard ceiling per the spec. We abort gracefully past this and write
# whatever's complete to the partial report.
HARD_CEILING_S = 2.5 * 3600

# Production default we read at startup so the report can be honest about
# what's actually shipped today (the spec text says 20, but the file may have
# moved on; we report the truth).
PRODUCTION_TOPN = retriever_mod._STAGE1_TOPN

_ADVERSARIAL_MARKER = "NOTHING"


# ---------------------------------------------------------------------------
# Cache hygiene  (intentionally narrower than benchmark.py — we must NOT wipe
# between topN sweeps because topN doesn't affect the embeddings)
# ---------------------------------------------------------------------------


def _wipe_index() -> None:
    p = BRAIN / INDEX_DIRNAME
    if p.exists():
        shutil.rmtree(p)


def _drop_st_model_cache() -> None:
    _ST_MODEL_CACHE.clear()
    gc.collect()


def _set_topn(n: int) -> None:
    """Inject the shortlist size by mutating the module constant.

    ``Retriever.query`` reads ``_STAGE1_TOPN`` from the module's global
    namespace at call time, so this takes effect on the *next* query without
    any retriever rebuild. Cheap and surgical — exactly what the ablation
    contract asks for.
    """
    retriever_mod._STAGE1_TOPN = int(n)


# ---------------------------------------------------------------------------
# Recall scoring  (matches benchmark.py — kept local so this script is self-
# contained and can be deleted without touching the bake-off harness)
# ---------------------------------------------------------------------------


def _normalize_path(p: str) -> str:
    return p.lower().replace("\\", "/")


def _is_adversarial(expected: str) -> bool:
    return _ADVERSARIAL_MARKER in expected


def _expected_alternatives(expected: str) -> list[str]:
    if _is_adversarial(expected):
        return []
    return [_normalize_path(p.strip()) for p in expected.split(" or ") if p.strip()]


def _hit_matches(file_path: str, stem: str) -> bool:
    return stem in _normalize_path(file_path)


def _compute_recall(per_query: list[dict[str, Any]]) -> dict[str, Any]:
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


# ---------------------------------------------------------------------------
# Per-config measurement
# ---------------------------------------------------------------------------


def _run_queries_capture(r: Retriever) -> list[dict[str, Any]]:
    """One full pass over QUERIES; capture timing AND top-3 hit metadata.

    Used for the *quality* run (rep 0) — we need the actual hits to compute
    recall and to feed the disagreement table at the topN extremes.
    """
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
                        "rerank_score": float(h.rerank_score),
                    }
                    for h in hits
                ],
            }
        )
    return out


def _run_queries_timing_only(r: Retriever) -> list[float]:
    """Latency-only pass; we throw the hits away.

    Skipping the dict construction / hit-copying overhead keeps the latency
    measurement closer to pure retriever cost. The quality run already gave
    us the hit data we need.
    """
    times: list[float] = []
    for q, _ in QUERIES:
        t0 = time.perf_counter()
        _ = r.query(q, top_k=3)
        times.append((time.perf_counter() - t0) * 1000)
    return times


def measure_config(
    r: Retriever, encoder_name: str, topn: int
) -> dict[str, Any]:
    """Run quality (1×) + latency (5×) for a fixed (encoder, topN)."""
    _set_topn(topn)

    # Rep 0: quality + first latency sample (all from the same pass — the
    # query results are deterministic at the top-3 level for a fixed
    # (encoder, reranker, topN), so reusing this rep for both quality and
    # the first latency sample is sound).
    quality_pass = _run_queries_capture(r)
    rep_means: list[float] = [
        sum(e["latency_ms"] for e in quality_pass) / max(1, len(quality_pass))
    ]

    # Reps 1..N-1: timing only.
    for _ in range(LATENCY_REPS - 1):
        times = _run_queries_timing_only(r)
        rep_means.append(sum(times) / max(1, len(times)))

    rec = _compute_recall(quality_pass)

    return {
        "encoder": encoder_name,
        "encoder_short": encoder_name.split("/")[-1],
        "topn": topn,
        "recall": rec,
        "rep_mean_ms": rep_means,
        "mean_ms": statistics.mean(rep_means),
        "median_ms": statistics.median(rep_means),
        "min_ms": min(rep_means),
        "max_ms": max(rep_means),
        "per_query": quality_pass,
    }


def measure_encoder(encoder_name: str) -> dict[str, Any]:
    """Cold-start once, then sweep all topNs against the same hot retriever."""
    print(f"\n{'=' * 72}\n[ablation] encoder = {encoder_name}\n{'=' * 72}",
          flush=True)

    _wipe_index()
    _drop_st_model_cache()
    gc.collect()

    t0 = time.perf_counter()
    encoder = BGEEncoder(model_name=encoder_name)
    r = Retriever(brain_root=BRAIN, encoder=encoder)
    cold_s = time.perf_counter() - t0
    print(
        f"  cold start: {cold_s:.2f}s  "
        f"({r.num_sections} sections; {r.backend_label})",
        flush=True,
    )

    return {
        "encoder": encoder_name,
        "encoder_short": encoder_name.split("/")[-1],
        "cold_s": cold_s,
        "retriever": r,  # kept for the topN sweep below
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _row_for(cfg: dict[str, Any]) -> str:
    rec = cfg["recall"]
    return (
        f"| {cfg['topn']} | {rec['r3']}/{rec['n']} | "
        f"{rec['r1_strict']}/{rec['n']} | "
        f"{cfg['mean_ms']:.0f} | {cfg['median_ms']:.0f} | "
        f"{cfg['min_ms']:.0f}–{cfg['max_ms']:.0f} |"
    )


def _headline_table(by_encoder: dict[str, list[dict[str, Any]]]) -> str:
    cells = by_encoder.get(HEADLINE_ENCODER, [])
    header = (
        "| topN | Recall@3 | R@1 strict | Mean latency (ms) | "
        "Median (ms) | Min–Max (ms) |\n"
        "|---|---|---|---|---|---|"
    )
    rows = [_row_for(c) for c in cells]
    return header + "\n" + ("\n".join(rows) if rows else "| _no data yet_ |  |  |  |  |  |")


def _cross_encoder_tables(by_encoder: dict[str, list[dict[str, Any]]]) -> str:
    parts: list[str] = []
    for enc in ENCODERS:
        if enc == HEADLINE_ENCODER:
            continue  # already covered by the headline section
        cells = by_encoder.get(enc, [])
        short = enc.split("/")[-1]
        parts.append(f"### `{short}`\n")
        header = (
            "| topN | Recall@3 | R@1 strict | Mean latency (ms) | "
            "Median (ms) | Min–Max (ms) |\n"
            "|---|---|---|---|---|---|"
        )
        rows = [_row_for(c) for c in cells]
        body = "\n".join(rows) if rows else "| _no data yet_ |  |  |  |  |  |"
        parts.append(header + "\n" + body + "\n")
    return "\n".join(parts)


def _quality_xychart(by_encoder: dict[str, list[dict[str, Any]]]) -> str:
    """Recall@3 vs topN, one line per encoder.

    Mermaid xychart-beta supports a single y-axis but multiple line series, so
    we plot all 3 encoders together. Recall is reported as raw count out of 14
    (the recall denominator), keeping the y-scale interpretable.
    """
    lines: list[str] = [
        "```mermaid",
        "xychart-beta",
        '    title "Recall@3 vs rerank shortlist size (topN)"',
        f"    x-axis [{', '.join(str(n) for n in TOP_NS)}]",
        '    y-axis "Recall@3 (out of 14)" 0 --> 14',
    ]
    for enc in ENCODERS:
        cells = by_encoder.get(enc, [])
        if not cells:
            continue
        # Pad missing topNs with 0s so the chart renders even mid-run.
        by_topn = {c["topn"]: c["recall"]["r3"] for c in cells}
        ys = [by_topn.get(n, 0) for n in TOP_NS]
        short = enc.split("/")[-1]
        ys_fmt = ", ".join(str(y) for y in ys)
        lines.append(f'    line "{short}" [{ys_fmt}]')
    lines.append("```")
    return "\n".join(lines)


def _latency_xychart(by_encoder: dict[str, list[dict[str, Any]]]) -> str:
    """Mean latency vs topN for the headline encoder only (per spec)."""
    cells = by_encoder.get(HEADLINE_ENCODER, [])
    by_topn = {c["topn"]: c["mean_ms"] for c in cells}
    ys = [by_topn.get(n, 0.0) for n in TOP_NS]
    if not any(ys):
        return "_no data yet_"
    # Pad y-axis upper bound so the line doesn't kiss the top of the chart.
    y_max = max(ys) * 1.15 if ys else 1.0
    lines = [
        "```mermaid",
        "xychart-beta",
        '    title "Mean latency vs topN — BGE-small (5-rep mean)"',
        f"    x-axis [{', '.join(str(n) for n in TOP_NS)}]",
        f'    y-axis "Mean latency (ms)" 0 --> {y_max:.0f}',
        f'    line [{", ".join(f"{y:.0f}" for y in ys)}]',
        "```",
    ]
    return "\n".join(lines)


def _disagreement_section(by_encoder: dict[str, list[dict[str, Any]]]) -> str:
    """For BGE-small only: queries where topN=4 and topN=30 picked
    different top-1 files. Skip ones where they agree.
    """
    cells = by_encoder.get(HEADLINE_ENCODER, [])
    by_topn = {c["topn"]: c for c in cells}
    lo = by_topn.get(4)
    hi = by_topn.get(30)
    if not lo or not hi:
        return "_topN=4 or topN=30 has not run yet — disagreement table will populate after the full sweep._\n"

    lines = [
        "Per-query top-1 disagreement between `topN=4` and `topN=30` for "
        "`bge-small-en-v1.5`. Trivial agreements (same top-1) are omitted.\n"
    ]
    diffs = 0
    for lo_e, hi_e in zip(lo["per_query"], hi["per_query"]):
        assert lo_e["query"] == hi_e["query"], "query order should be deterministic"
        lo_top1 = lo_e["hits"][0]["file_path"] if lo_e["hits"] else ""
        hi_top1 = hi_e["hits"][0]["file_path"] if hi_e["hits"] else ""
        if lo_top1 == hi_top1:
            continue
        diffs += 1
        lines.append(f"**Q.** `{lo_e['query']}`  ")
        lines.append(f"_expected:_ `{lo_e['expected']}`\n")
        lines.append("| Rank | topN=4 | topN=30 |")
        lines.append("|---|---|---|")
        for rank in range(3):
            lo_h = lo_e["hits"][rank] if rank < len(lo_e["hits"]) else None
            hi_h = hi_e["hits"][rank] if rank < len(hi_e["hits"]) else None
            lo_str = (
                f"`{lo_h['file_path']}` :: {lo_h['heading']} "
                f"(rerank={lo_h['rerank_score']:.3f})"
                if lo_h else "_—_"
            )
            hi_str = (
                f"`{hi_h['file_path']}` :: {hi_h['heading']} "
                f"(rerank={hi_h['rerank_score']:.3f})"
                if hi_h else "_—_"
            )
            lines.append(f"| {rank + 1} | {lo_str} | {hi_str} |")
        lines.append("")
    if diffs == 0:
        lines.append("_No top-1 disagreements between topN=4 and topN=30 — "
                     "the reranker is dominating the final ordering across "
                     "the full topN range tested._")
    return "\n".join(lines)


def _findings_and_recommendation(
    by_encoder: dict[str, list[dict[str, Any]]],
    elapsed_s: float,
    aborted: bool,
) -> str:
    """Auto-generated findings stub.

    We compute the actual numbers (best-recall topN per encoder, latency
    elbow, etc.) then phrase the bullets in plain language. The recommendation
    itself is data-driven: pick the smallest topN whose Recall@3 is within 1
    of the best across the BGE row, with the latency win quantified.
    """
    parts: list[str] = []

    bge_cells = by_encoder.get(HEADLINE_ENCODER, [])
    if not bge_cells:
        return "_Findings will populate once the BGE row has at least one cell._"

    best_r3 = max(c["recall"]["r3"] for c in bge_cells)
    # "Within 1" tolerance is generous on a 14-query denominator (one query
    # = 7.1pp); we tighten if the data justifies it.
    candidates = [c for c in bge_cells if c["recall"]["r3"] >= best_r3 - 1]
    smallest_within = min(candidates, key=lambda c: c["topn"])
    fastest = min(bge_cells, key=lambda c: c["mean_ms"])
    slowest = max(bge_cells, key=lambda c: c["mean_ms"])

    # Recall trends per encoder
    parts.append("### Findings\n")
    for enc in ENCODERS:
        cells = by_encoder.get(enc, [])
        if not cells:
            continue
        short = enc.split("/")[-1]
        r3s = [c["recall"]["r3"] for c in cells]
        r1s = [c["recall"]["r1_strict"] for c in cells]
        topns = [c["topn"] for c in cells]
        r3_str = ", ".join(
            f"topN={n}→{r}/{cells[0]['recall']['n']}" for n, r in zip(topns, r3s)
        )
        parts.append(
            f"- **`{short}` Recall@3:** {r3_str}. "
            f"R@1 strict ranges {min(r1s)}–{max(r1s)} of "
            f"{cells[0]['recall']['n']} across the topN sweep."
        )

    parts.append(
        f"- **Latency elbow (BGE):** topN={fastest['topn']} is the fastest "
        f"({fastest['mean_ms']:.0f} ms mean); topN={slowest['topn']} is the "
        f"slowest ({slowest['mean_ms']:.0f} ms mean). "
        f"That's a {slowest['mean_ms'] - fastest['mean_ms']:.0f} ms spread, "
        f"≈{(slowest['mean_ms'] / max(1.0, fastest['mean_ms'])):.1f}× ratio "
        f"between the extremes."
    )

    # Caveats
    parts.append(
        "- **Statistical caveat:** the denominator is 14 queries — one "
        "query flipping is ~7 percentage points. Single-query recall "
        "differences across topN are inside the noise floor and should not "
        "drive the recommendation; only consistent multi-query trends do."
    )
    parts.append(
        "- **Latency noise:** 5 reps bound CPU jitter but do not eliminate it. "
        "The min–max range column is the relevant uncertainty band per cell."
    )

    if aborted:
        parts.append(
            f"- **Run aborted at the 2.5h ceiling** — partial cells only. "
            f"Treat any encoder/topN with no data as missing, not 0."
        )

    parts.append("")
    parts.append("### Recommendation\n")

    # Quantify the win vs production (whatever production happens to be).
    prod_cell = next((c for c in bge_cells if c["topn"] == PRODUCTION_TOPN), None)
    rec_cell = smallest_within  # smallest topN that doesn't lose recall
    if prod_cell and rec_cell["topn"] != PRODUCTION_TOPN:
        latency_delta = prod_cell["mean_ms"] - rec_cell["mean_ms"]
        recall_delta = rec_cell["recall"]["r3"] - prod_cell["recall"]["r3"]
        verdict_yes = (
            latency_delta > 0  # candidate is faster
            and recall_delta >= 0  # and not worse on recall@3
        )
    else:
        verdict_yes = False
        latency_delta = 0.0
        recall_delta = 0

    parts.append(
        f"_Production today: `_STAGE1_TOPN = {PRODUCTION_TOPN}`._ "
        "(Reading the live module constant; the spec text said 20 but the "
        "previous bake-off already lowered it.)\n"
    )

    if verdict_yes:
        parts.append(
            f"**Yes** — change `_STAGE1_TOPN` from {PRODUCTION_TOPN} to "
            f"**{rec_cell['topn']}**.\n\n"
            f"- **Evidence:** at topN={rec_cell['topn']} BGE-small holds "
            f"Recall@3 = {rec_cell['recall']['r3']}/{rec_cell['recall']['n']} "
            f"(vs {prod_cell['recall']['r3']}/{prod_cell['recall']['n']} at "
            f"topN={PRODUCTION_TOPN}, Δ={recall_delta:+d} queries), while mean "
            f"latency drops by ~{latency_delta:.0f} ms "
            f"({rec_cell['mean_ms']:.0f} ms vs {prod_cell['mean_ms']:.0f} ms).\n"
            f"- **Cross-encoder check:** see the `bce-embedding-base_v1` and "
            f"`e5-small-v2` tables for whether the same elbow shows up "
            f"under different first-stage encoders.\n"
            f"- **Risk:** the recall@3 ceiling on this corpus appears to be "
            f"hit even at small topN, so the main risk is queries whose "
            f"correct section ranks dense-only #{rec_cell['topn'] + 1}–{PRODUCTION_TOPN} "
            f"and would have been rescued by a wider shortlist. Inspect the "
            f"per-query disagreement table above for any such cases before "
            f"shipping."
        )
    elif prod_cell and rec_cell["topn"] == PRODUCTION_TOPN:
        parts.append(
            f"**No** — keep `_STAGE1_TOPN = {PRODUCTION_TOPN}`. "
            f"Among configs whose Recall@3 is within 1 of the best on this "
            f"15-query set, {PRODUCTION_TOPN} is already the smallest. "
            f"Smaller topN values lose recall; larger ones spend latency "
            f"without buying quality. The current production value is on "
            f"the elbow."
        )
    elif rec_cell["topn"] > PRODUCTION_TOPN and prod_cell:
        parts.append(
            f"**Cautious yes** — consider raising `_STAGE1_TOPN` from "
            f"{PRODUCTION_TOPN} to {rec_cell['topn']}. At topN={rec_cell['topn']} "
            f"BGE-small reaches Recall@3 = {rec_cell['recall']['r3']}"
            f"/{rec_cell['recall']['n']} (Δ={recall_delta:+d} vs production), "
            f"costing ~{rec_cell['mean_ms'] - prod_cell['mean_ms']:.0f} ms "
            f"of mean latency. Justified only if that recall lift survives "
            f"the cross-encoder check above and the per-query inspection "
            f"shows the rescued queries are real wins, not noise."
        )
    else:
        parts.append(
            "**Inconclusive** — no production-comparison cell available. "
            "Re-run with the current production topN included in the sweep "
            "(it should be — see the cells above)."
        )

    parts.append(
        f"\n_Total runtime: {elapsed_s / 60:.1f} min."
        + (" (aborted at ceiling)" if aborted else "")
        + "_"
    )
    return "\n".join(parts)


def write_report(
    by_encoder: dict[str, list[dict[str, Any]]],
    cold_starts: dict[str, float],
    elapsed_s: float,
    aborted: bool = False,
) -> None:
    """Render the entire ablation-results.md from the current state.

    Called after every ``(encoder, topN)`` cell so partial progress is always
    on disk. The file is overwritten in full each time — the dataset is small
    enough that re-rendering is free and we never have to worry about stale
    fragments.
    """
    cold_lines = []
    for enc in ENCODERS:
        if enc in cold_starts:
            cold_lines.append(
                f"  - `{enc.split('/')[-1]}`: {cold_starts[enc]:.2f}s"
            )
        else:
            cold_lines.append(f"  - `{enc.split('/')[-1]}`: _not run_")

    parts: list[str] = [
        "# Rerank shortlist size ablation\n",
        f"_Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}_  ",
        f"_Total runtime so far: {elapsed_s / 60:.1f} min_"
        + ("  *(run aborted at 2.5h ceiling — partial)*" if aborted else "")
        + "\n",
        "## Setup\n",
        "- **Corpus:** `brian/` (94 sections, 21 files)",
        "- **Test set:** 15 queries from `scripts/eval.py` (recall denominator "
        "= 14 — adversarial query excluded)",
        "- **Reranker held constant:** `BAAI/bge-reranker-base` (cross-encoder)",
        "- **Authority blend / token packing:** unchanged from production",
        f"- **topN sweep:** {TOP_NS}",
        f"- **Encoders:** {[e.split('/')[-1] for e in ENCODERS]}",
        f"- **Latency repetitions:** {LATENCY_REPS} per config (in series; "
        "report mean / median / min–max across reps)",
        "- **Cold start:** measured once per encoder (encoder-load-bound, "
        "not topN-bound):",
        *cold_lines,
        f"- **Production default at run start:** `_STAGE1_TOPN = "
        f"{PRODUCTION_TOPN}` (read live from `retriever.py`; the script does "
        f"not modify it).",
        "",
        f"## Headline: BGE-small ({HEADLINE_ENCODER.split('/')[-1]} — "
        "production encoder)\n",
        _headline_table(by_encoder),
        "",
        "## Cross-encoder validation\n",
        "Same sweep run against the other two encoders. The point isn't a "
        "horse race between encoders (held constant in production); it's to "
        "see whether the topN curve trends the same way under different "
        "first-stage embeddings. If it does, the BGE conclusion is robust.\n",
        _cross_encoder_tables(by_encoder),
        "## Quality plot — Recall@3 vs topN\n",
        _quality_xychart(by_encoder),
        "",
        "## Latency plot — mean ms vs topN (BGE-small)\n",
        _latency_xychart(by_encoder),
        "",
        "## Per-query disagreements at topN extremes\n",
        _disagreement_section(by_encoder),
        "",
        "## Findings & recommendation\n",
        _findings_and_recommendation(by_encoder, elapsed_s, aborted),
    ]

    RESULTS_PATH.write_text("\n".join(parts), encoding="utf-8")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    print(f"[ablation] brain_root      = {BRAIN}", flush=True)
    print(f"[ablation] encoders        = {ENCODERS}", flush=True)
    print(f"[ablation] topNs           = {TOP_NS}", flush=True)
    print(f"[ablation] latency reps    = {LATENCY_REPS}", flush=True)
    print(f"[ablation] hard ceiling    = {HARD_CEILING_S / 3600:.1f} h", flush=True)
    print(f"[ablation] production topN = {PRODUCTION_TOPN} (live)", flush=True)
    print(f"[ablation] output          = "
          f"{RESULTS_PATH.relative_to(REPO_ROOT).as_posix()}", flush=True)

    by_encoder: dict[str, list[dict[str, Any]]] = {e: [] for e in ENCODERS}
    cold_starts: dict[str, float] = {}

    overall_t0 = time.perf_counter()
    aborted = False

    try:
        for enc in ENCODERS:
            elapsed = time.perf_counter() - overall_t0
            if elapsed > HARD_CEILING_S:
                print(f"\n[ablation] HARD CEILING hit before {enc} "
                      f"(elapsed={elapsed / 60:.1f} min). Aborting.", flush=True)
                aborted = True
                break

            try:
                enc_state = measure_encoder(enc)
            except Exception as e:
                traceback.print_exc()
                print(f"[ablation] encoder {enc} failed to load: {e}", flush=True)
                continue

            cold_starts[enc] = enc_state["cold_s"]
            r = enc_state["retriever"]

            try:
                for topn in TOP_NS:
                    elapsed = time.perf_counter() - overall_t0
                    if elapsed > HARD_CEILING_S:
                        print(f"\n[ablation] HARD CEILING hit during {enc} "
                              f"topN={topn} (elapsed={elapsed / 60:.1f} min). "
                              f"Aborting.", flush=True)
                        aborted = True
                        break

                    cfg_t0 = time.perf_counter()
                    try:
                        cell = measure_config(r, enc, topn)
                    except Exception as e:
                        traceback.print_exc()
                        print(f"[ablation] cell ({enc}, topN={topn}) failed: {e}",
                              flush=True)
                        continue
                    cfg_dt = time.perf_counter() - cfg_t0

                    by_encoder[enc].append(cell)
                    rec = cell["recall"]
                    print(
                        f"  [topN={cell['topn']:>2}] "
                        f"R@3={rec['r3']}/{rec['n']}  "
                        f"R@1s={rec['r1_strict']}/{rec['n']}  "
                        f"R@1l={rec['r1_lenient']}/{rec['n']}  "
                        f"mean={cell['mean_ms']:.0f}ms  "
                        f"med={cell['median_ms']:.0f}ms  "
                        f"min-max={cell['min_ms']:.0f}-{cell['max_ms']:.0f}ms "
                        f"  (cell={cfg_dt:.1f}s, "
                        f"total={ (time.perf_counter() - overall_t0) / 60:.1f}m)",
                        flush=True,
                    )

                    # Partial-write safety: dump the whole report after every
                    # cell so any subsequent abort still leaves the latest
                    # snapshot on disk.
                    write_report(
                        by_encoder,
                        cold_starts,
                        time.perf_counter() - overall_t0,
                        aborted=False,
                    )
            finally:
                # Drop the retriever before moving to the next encoder so the
                # ST model + cached embeddings can be GC'd before we wipe.
                del r, enc_state
                gc.collect()
    finally:
        # Restore the production topN constant no matter what — the script's
        # contract is to leave the module exactly as it found it.
        _set_topn(PRODUCTION_TOPN)

    elapsed_s = time.perf_counter() - overall_t0
    write_report(by_encoder, cold_starts, elapsed_s, aborted=aborted)
    # Plain ASCII separator — Windows cp1252 console can't print '\u2192'.
    print(f"\n[ablation] done in {elapsed_s / 60:.1f} min  "
          f"(aborted={aborted})  ->  "
          f"{RESULTS_PATH.relative_to(REPO_ROOT).as_posix()}", flush=True)


if __name__ == "__main__":
    main()
