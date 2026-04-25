"""Two-stage Retriever with token-aware bundling.

Pipeline:

1. ``build_index`` walks the brain root and parses all Markdown into
   :class:`Section` objects (with an incremental on-disk cache).
2. The :class:`Encoder` (BGE dense or BM25 fallback) scores every section
   against the query; the top 20 advance to stage 2.
3. The :class:`Reranker` (BGE cross-encoder or keyword fallback) re-scores the
   shortlist for higher-precision ordering.
4. Authority weights from ``frontmatter.source.kind`` give a small final boost
   so durable artefacts (ADRs, merged PRs) outrank ephemera (Slack, demos).
5. A greedy token packer trims the final bundle to ``token_budget``, with a
   small overshoot allowed to keep mandatory ``context/*`` sections (the
   constraints/open-questions backbone) when they made the shortlist.

The class also exposes :meth:`query_section_ids` and :meth:`all_sections` for
the update module: the reconciler needs to address sections by stable ID and
to enumerate everything when proposing where new content should live.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .authority import authority_for
from .encoder import BGEEncoder, BM25Encoder, Encoder, make_encoder
from .index import INDEX_DIRNAME, build_index
from .parser import Section
from .reranker import BGEReranker, KeywordReranker, Reranker, make_reranker

# Public locked dataclass — Seat 2 imports this. Keep field names stable.
@dataclass
class RetrievalHit:
    file_path: str
    section_id: str
    heading: str
    content: str
    dense_score: float
    rerank_score: float
    tokens: int
    frontmatter: dict
    source_kind: str | None = None


# Stage-1 shortlist size. Cross-encoder cost is roughly linear in this number.
_STAGE1_TOPN = 20

# Files inside this directory are "always preferred" for short queries about
# constraints / undecided issues. They get a soft floor in the bundle even when
# the budget is tight.
_PRIORITY_PREFIX = "context/"

# How much over budget we'll go to keep priority sections (20%).
_BUDGET_OVERSHOOT = 0.20

# Authority blend weight: ``final = rerank * (1 - W) + rerank * authority * W``
# Picked small (0.15) so authority breaks ties without overpowering relevance.
_AUTHORITY_WEIGHT = 0.15


def _make_encoder() -> Encoder:
    return make_encoder(prefer_dense=True)


def _make_reranker() -> Reranker:
    return make_reranker(prefer_cross_encoder=True)


class _TokenCounter:
    """Wraps tiktoken with a regex-based fallback so import order can't break.

    We don't bother caching encoders — tiktoken handles that internally.
    """

    def __init__(self) -> None:
        self._enc = None
        try:
            import tiktoken  # type: ignore

            self._enc = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self._enc = None

    def count(self, text: str) -> int:
        if not text:
            return 0
        if self._enc is not None:
            try:
                return len(self._enc.encode(text))
            except Exception:
                pass
        # Fallback: ~4 chars per token is the standard rule of thumb.
        return max(1, len(text) // 4)


class Retriever:
    """Index-once, query-many retriever over a Markdown brain root.

    Construction is intentionally synchronous so the caller knows exactly when
    indexing happens. The first ``__init__`` build is the slowest step;
    subsequent runs in the same process reuse the in-memory state, and
    subsequent process starts reuse the on-disk ``.index/sections.json``.
    """

    def __init__(
        self,
        brain_root: Path,
        *,
        encoder: Encoder | None = None,
        reranker: Reranker | None = None,
    ) -> None:
        self.brain_root = Path(brain_root).resolve()
        if not self.brain_root.is_dir():
            raise FileNotFoundError(f"Brain root not found: {self.brain_root}")

        self._sections: list[Section] = build_index(self.brain_root)
        self._tokens = _TokenCounter()

        # Pre-compute token counts so query() is dominated by encoder/reranker.
        self._section_tokens: list[int] = [
            self._tokens.count(s.text_for_embedding) for s in self._sections
        ]

        self.encoder: Encoder = encoder or _make_encoder()
        self.reranker: Reranker = reranker or _make_reranker()

        # Persist dense embeddings next to the section index so warm starts
        # don't re-run the BGE encoder on unchanged corpora. Only the dense
        # backend bothers — BM25 is so cheap to rebuild it isn't worth caching.
        if isinstance(self.encoder, BGEEncoder):
            self.encoder.set_cache_path(
                self.brain_root / INDEX_DIRNAME / "embeddings.npz"
            )

        corpus = [s.text_for_embedding or s.heading for s in self._sections]
        self.encoder.encode_corpus(corpus)

        # Section-id lookup table for query_section_ids(). Used by Seat 2.
        self._by_id: dict[str, int] = {
            s.section_id: i for i, s in enumerate(self._sections)
        }

    # --- public surface ----------------------------------------------------

    def query(
        self,
        text: str,
        top_k: int = 5,
        token_budget: int = 2000,
    ) -> list[RetrievalHit]:
        """Return ranked, token-packed hits for the query string."""
        if not self._sections:
            return []

        dense_scores = self.encoder.score(text)
        if not dense_scores:
            return []

        # Stage 1: take top-N by dense/lexical score.
        ranked = sorted(
            range(len(self._sections)),
            key=lambda i: dense_scores[i],
            reverse=True,
        )
        shortlist_idx = ranked[:_STAGE1_TOPN]
        shortlist_sections = [self._sections[i] for i in shortlist_idx]

        # Stage 2: cross-encoder / keyword rerank.
        reranked = self.reranker.rerank(text, shortlist_sections)

        # Authority blend (small, multiplicative).
        blended: list[tuple[Section, float, float]] = []
        for sec, rerank_score in reranked:
            auth = authority_for(sec.source_kind)
            final = rerank_score * (1.0 - _AUTHORITY_WEIGHT) + (
                rerank_score * auth * _AUTHORITY_WEIGHT
            )
            blended.append((sec, rerank_score, final))
        blended.sort(key=lambda x: x[2], reverse=True)

        dense_by_id: dict[str, float] = {
            self._sections[i].section_id: dense_scores[i] for i in shortlist_idx
        }

        # Token packing: greedy from the top, with priority-section overshoot.
        cap_with_overshoot = int(token_budget * (1.0 + _BUDGET_OVERSHOOT))
        out: list[RetrievalHit] = []
        used_tokens = 0

        def make_hit(sec: Section, rerank_score: float) -> RetrievalHit:
            i = self._by_id[sec.section_id]
            return RetrievalHit(
                file_path=sec.file_path,
                section_id=sec.section_id,
                heading=sec.heading,
                content=sec.content,
                dense_score=float(dense_by_id.get(sec.section_id, 0.0)),
                rerank_score=float(rerank_score),
                tokens=int(self._section_tokens[i]),
                frontmatter=dict(sec.frontmatter),
                source_kind=sec.source_kind,
            )

        # Pass 1: top-K under the strict budget.
        for sec, rerank_score, _final in blended:
            if len(out) >= top_k:
                break
            tokens = self._section_tokens[self._by_id[sec.section_id]]
            if out and used_tokens + tokens > token_budget:
                continue
            out.append(make_hit(sec, rerank_score))
            used_tokens += tokens

        # Pass 2: ensure priority context/* sections from the shortlist are
        # included if they fit within the ≤20% overshoot allowance.
        already = {h.section_id for h in out}
        for sec, rerank_score, _final in blended:
            if sec.section_id in already or not _is_priority(sec):
                continue
            tokens = self._section_tokens[self._by_id[sec.section_id]]
            if used_tokens + tokens > cap_with_overshoot:
                continue
            out.append(make_hit(sec, rerank_score))
            used_tokens += tokens

        return out

    def query_section_ids(self, ids: list[str]) -> list[RetrievalHit]:
        """Resolve one or more section IDs to :class:`RetrievalHit` records.

        Used by the update module to pull current content for sections it
        plans to modify. Unknown IDs are silently dropped — the caller already
        decides which IDs are relevant.
        """
        out: list[RetrievalHit] = []
        for sid in ids:
            i = self._by_id.get(sid)
            if i is None:
                continue
            sec = self._sections[i]
            out.append(
                RetrievalHit(
                    file_path=sec.file_path,
                    section_id=sec.section_id,
                    heading=sec.heading,
                    content=sec.content,
                    dense_score=0.0,
                    rerank_score=0.0,
                    tokens=int(self._section_tokens[i]),
                    frontmatter=dict(sec.frontmatter),
                    source_kind=sec.source_kind,
                )
            )
        return out

    def all_sections(self) -> list[RetrievalHit]:
        """Return every indexed section as a :class:`RetrievalHit`.

        Scores are zeroed because there's no query. Useful for the reconciler
        when it needs to scan the whole brain to find a placement target.
        """
        return [
            RetrievalHit(
                file_path=s.file_path,
                section_id=s.section_id,
                heading=s.heading,
                content=s.content,
                dense_score=0.0,
                rerank_score=0.0,
                tokens=int(self._section_tokens[i]),
                frontmatter=dict(s.frontmatter),
                source_kind=s.source_kind,
            )
            for i, s in enumerate(self._sections)
        ]

    # --- introspection used by README perf section / tests -----------------

    @property
    def backend_label(self) -> str:
        """Human-readable string describing which backends are active."""
        enc_kind = "dense" if isinstance(self.encoder, BGEEncoder) else "sparse"
        rer_kind = (
            "cross-encoder" if isinstance(self.reranker, BGEReranker) else "keyword"
        )
        if isinstance(self.encoder, BM25Encoder):
            enc_kind = "bm25"
        if isinstance(self.reranker, KeywordReranker):
            rer_kind = "keyword"
        return f"encoder={self.encoder.name} ({enc_kind}); reranker={self.reranker.name} ({rer_kind})"

    @property
    def num_sections(self) -> int:
        return len(self._sections)


def _is_priority(s: Section | RetrievalHit) -> bool:
    return s.file_path.startswith(_PRIORITY_PREFIX)
