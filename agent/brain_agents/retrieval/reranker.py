"""Second-stage rerankers.

Cross-encoder reranking is much more accurate than a single-vector encoder for
the top-k bucket, but it's also the most fragile dependency (torch + downloaded
weights). We mirror the encoder pattern: try the BGE cross-encoder, fall back
to a deterministic keyword overlap reranker.
"""

from __future__ import annotations

import re
from typing import Protocol

from .parser import Section


class Reranker(Protocol):
    name: str

    def rerank(
        self, query: str, candidates: list[Section]
    ) -> list[tuple[Section, float]]: ...


_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
_STOPWORDS = frozenset(
    {
        "a", "an", "the", "of", "to", "and", "or", "in", "on", "for", "with",
        "is", "are", "was", "were", "be", "been", "being", "it", "this", "that",
        "those", "these", "do", "does", "did", "have", "has", "had", "as", "by",
        "at", "from", "but", "if", "than", "then", "into", "about", "we", "you",
        "they", "i", "me", "my", "our", "your", "their", "there", "here",
        "what", "which", "who", "whom", "whose", "how", "why", "when", "where",
        "can", "could", "should", "would", "may", "might", "will", "shall",
        "not", "no", "so", "such", "any", "all", "some", "each", "every",
    }
)


def _stem(token: str) -> str:
    """Tiny suffix stripper. Avoids a heavy dependency like NLTK."""
    t = token.lower()
    for suffix in ("ions", "ing", "ies", "ed", "es", "ly", "s"):
        if len(t) > len(suffix) + 2 and t.endswith(suffix):
            return t[: -len(suffix)]
    return t


def _stems(text: str) -> set[str]:
    return {
        _stem(t)
        for t in _TOKEN_RE.findall(text.lower())
        if t not in _STOPWORDS and len(t) > 1
    }


class KeywordReranker:
    """Stemmed Jaccard overlap. Fast, deterministic, no model required."""

    name = "keyword"

    def rerank(
        self, query: str, candidates: list[Section]
    ) -> list[tuple[Section, float]]:
        q_stems = _stems(query)
        if not q_stems:
            return [(c, 0.0) for c in candidates]
        scored: list[tuple[Section, float]] = []
        for c in candidates:
            doc_stems = _stems(c.text_for_embedding)
            if not doc_stems:
                scored.append((c, 0.0))
                continue
            inter = len(q_stems & doc_stems)
            # Lean recall-friendly: divide by query size, not Jaccard union.
            # Boost heading matches because users often paraphrase headings.
            heading_overlap = len(q_stems & _stems(c.heading))
            score = inter / len(q_stems) + 0.25 * heading_overlap
            scored.append((c, float(min(score, 1.0))))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored


# Same module-level caching pattern as encoder.py: cross-encoder weights are
# the most expensive thing in the whole pipeline (~270 MB for base), and
# reloading them on every Retriever instantiation murders warm-load latency.
_CE_MODEL_CACHE: dict[str, object] = {}


def _load_cross_encoder(model_name: str):
    cached = _CE_MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached
    from sentence_transformers import CrossEncoder

    m = CrossEncoder(model_name)
    # Warm the underlying torch graph once: the very first ``predict`` call
    # incurs JIT/cudnn benchmarking that adds 3-7 seconds of latency to query
    # #1. Doing it here amortizes that cost into module load time instead.
    try:
        m.predict([("warmup", "warmup text for the model")], show_progress_bar=False)
    except Exception:
        pass
    _CE_MODEL_CACHE[model_name] = m
    return m


class BGEReranker:
    """Cross-encoder reranker using ``BAAI/bge-reranker-base``."""

    name = "bge-reranker-base"

    def __init__(self, model_name: str = "BAAI/bge-reranker-base") -> None:
        self._model = _load_cross_encoder(model_name)

    # bge-reranker-base has a 512-token context window. Long sections (e.g.
    # full architecture pages) get truncated by the tokenizer anyway, but
    # capping by characters first makes per-pair inference noticeably faster
    # on CPU and avoids expensive tokenization of huge tail content.
    _RERANK_MAX_CHARS = 1200

    def rerank(
        self, query: str, candidates: list[Section]
    ) -> list[tuple[Section, float]]:
        if not candidates:
            return []
        pairs = [
            (query, c.text_for_embedding[: self._RERANK_MAX_CHARS])
            for c in candidates
        ]
        raw = self._model.predict(
            pairs, show_progress_bar=False, batch_size=16
        )
        # CrossEncoder logits are unbounded; squash with sigmoid for stability.
        import math

        def sig(x: float) -> float:
            return 1.0 / (1.0 + math.exp(-x))

        scored = [(c, float(sig(float(s)))) for c, s in zip(candidates, raw)]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored


def make_reranker(prefer_cross_encoder: bool = True) -> Reranker:
    """Return the best available reranker (BGE cross-encoder, else keyword)."""
    if prefer_cross_encoder:
        try:
            return BGEReranker()
        except Exception:
            pass
    return KeywordReranker()
