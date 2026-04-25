"""First-stage encoders.

Two implementations with the same surface area:

* :class:`BGEEncoder` — dense embeddings via ``sentence-transformers``
  ``BAAI/bge-small-en-v1.5`` (384-dim). Provides cosine similarity scoring.
* :class:`BM25Encoder` — sparse lexical fallback via ``rank-bm25``. Used
  whenever the BGE model can't be loaded (no torch wheel, no model cache, no
  network — the local-demo guarantee from ADR-0002).

Both expose:

    encode_corpus(texts: list[str]) -> None    # build internal index
    score(query: str) -> list[float]           # one score per corpus doc

Return shapes differ internally — the :class:`Retriever` only ever calls
``score`` and works against either backend transparently.
"""

from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path
from typing import Optional, Protocol


class Encoder(Protocol):
    """Common interface so the Retriever doesn't care which backend it has."""

    name: str

    def encode_corpus(self, texts: list[str]) -> None: ...

    def score(self, query: str) -> list[float]: ...


_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text)]


class BM25Encoder:
    """BM25 fallback that never touches the network or disk model cache."""

    name = "bm25"

    def __init__(self) -> None:
        from rank_bm25 import BM25Okapi  # local import keeps cold-start fast

        self._BM25Okapi = BM25Okapi
        self._bm25 = None
        self._n_docs = 0

    def encode_corpus(self, texts: list[str]) -> None:
        tokenized = [_tokenize(t) or ["__empty__"] for t in texts]
        self._n_docs = len(tokenized)
        self._bm25 = self._BM25Okapi(tokenized) if tokenized else None

    def score(self, query: str) -> list[float]:
        if self._bm25 is None or self._n_docs == 0:
            return []
        q = _tokenize(query) or ["__empty__"]
        raw = self._bm25.get_scores(q)
        # Normalize to [0, 1] so dense and sparse paths are comparable when
        # callers want a single threshold. Use sigmoid-style squash: BM25
        # scores are unbounded above, so we divide by (max + 1e-6).
        max_s = float(max(raw)) if len(raw) else 0.0
        if max_s <= 0:
            return [0.0] * len(raw)
        return [float(s) / max_s for s in raw]


# Module-level model cache: loading the BGE weights costs ~5-30s on CPU and
# is the dominant warm-start cost. We load each model exactly once per process
# and share it across Retriever instances. The model objects are read-only
# after construction and ``encode`` is thread-safe in sentence-transformers.
_ST_MODEL_CACHE: dict[str, object] = {}


def _load_st_model(model_name: str):
    cached = _ST_MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached
    from sentence_transformers import SentenceTransformer

    m = SentenceTransformer(model_name)
    _ST_MODEL_CACHE[model_name] = m
    return m


# Per-model prompt formatting. Each entry is ``(query_prefix, doc_prefix)``
# applied as ``f"{prefix}{text}"`` before feeding the sentence-transformer.
# Keys are matched as case-insensitive substrings of the model name so the
# same rule covers a family (e5-small / e5-base / multilingual-e5).
#
# References:
#   * BGE   — https://huggingface.co/BAAI/bge-small-en-v1.5  (query-only prefix)
#   * E5    — https://huggingface.co/intfloat/e5-small-v2    (both query+passage)
#   * BCE   — https://huggingface.co/maidalun1020/bce-embedding-base_v1
#             (no instruction; identity formatting)
_MODEL_PROMPTS: list[tuple[str, str, str]] = [
    # (substring, query_prefix, doc_prefix)
    ("e5", "query: ", "passage: "),
    ("bge", "Represent this sentence for searching relevant passages: ", ""),
    ("bce", "", ""),
]


def _prompts_for(model_name: str) -> tuple[str, str]:
    n = model_name.lower()
    for needle, qp, dp in _MODEL_PROMPTS:
        if needle in n:
            return qp, dp
    return "", ""  # safe default for unknown models


class BGEEncoder:
    """Dense encoder backed by a ``sentence-transformers`` model.

    The class is named after the default checkpoint
    (``BAAI/bge-small-en-v1.5``, 384-dim) but accepts any model resolvable
    by ``sentence-transformers``. Per-family prompt formatting (BGE query
    prefix, E5 ``query:``/``passage:`` prefixes, BCE no-prefix) is dispatched
    via :data:`_MODEL_PROMPTS`.

    Loaded lazily so import never fails on machines without torch. The
    constructor raises if the model can't be obtained (no cache + no network);
    the :class:`Retriever` catches that and falls back to BM25.

    Embeddings are persisted via :meth:`set_cache_path` keyed by a hash of the
    corpus + model name so that warm starts avoid re-encoding identical text.
    """

    # Class-level default kept for callers that introspect ``BGEEncoder.name``
    # before instantiating. Instances always overwrite with a model-derived
    # value in ``__init__``.
    name = "bge-small-en-v1.5"

    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5") -> None:
        self._model = _load_st_model(model_name)
        self._model_name = model_name
        # Friendly short name (e.g. "bge-small-en-v1.5", "e5-small-v2"). Used
        # by ``Retriever.backend_label`` and the benchmark report.
        self.name = model_name.split("/")[-1]
        self._query_prefix, self._doc_prefix = _prompts_for(model_name)
        self._embeddings = None  # numpy array, shape (n_docs, dim)
        self._cache_path: Path | None = None

    def set_cache_path(self, path: Path) -> None:
        """Configure where ``encode_corpus`` may persist computed embeddings.

        Pass ``None``-equivalent (don't call this) to disable disk caching.
        """
        self._cache_path = path

    def _format_query(self, text: str) -> str:
        return f"{self._query_prefix}{text}"

    def _format_doc(self, text: str) -> str:
        return f"{self._doc_prefix}{text}" if self._doc_prefix else text

    def _corpus_fingerprint(self, texts: list[str]) -> str:
        h = hashlib.sha256()
        h.update(self._model_name.encode("utf-8"))
        # Doc prefix is part of the cache key so swapping prompt formats forces
        # a re-encode even if the model name and texts are identical.
        h.update(b"\x01")
        h.update(self._doc_prefix.encode("utf-8"))
        for t in texts:
            h.update(b"\x00")
            h.update(t.encode("utf-8", errors="replace"))
        return h.hexdigest()

    def encode_corpus(self, texts: list[str]) -> None:
        import numpy as np

        if not texts:
            self._embeddings = np.zeros((0, 0), dtype="float32")
            return

        fingerprint = self._corpus_fingerprint(texts)
        cache_p = self._cache_path
        if cache_p is not None and cache_p.is_file():
            try:
                npz = np.load(cache_p, allow_pickle=False)
                if (
                    "fingerprint" in npz.files
                    and "embeddings" in npz.files
                    and str(npz["fingerprint"].item()) == fingerprint
                ):
                    self._embeddings = npz["embeddings"].astype("float32")
                    return
            except Exception:
                pass  # fall through to re-encode

        formatted = [self._format_doc(t) for t in texts]
        emb = self._model.encode(
            formatted,
            batch_size=32,
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        ).astype("float32")
        self._embeddings = emb

        if cache_p is not None:
            try:
                cache_p.parent.mkdir(parents=True, exist_ok=True)
                np.savez(cache_p, embeddings=emb, fingerprint=np.array(fingerprint))
            except Exception:
                pass  # caching is best-effort; never fail the encode

    def score(self, query: str) -> list[float]:
        import numpy as np

        if self._embeddings is None or self._embeddings.size == 0:
            return []
        q_vec = self._model.encode(
            [self._format_query(query)],
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )[0].astype("float32")
        sims = self._embeddings @ q_vec  # cosine because both are L2-normalized
        # Map [-1, 1] -> [0, 1] for downstream blending.
        return [float((s + 1.0) / 2.0) for s in sims.tolist()]


def make_encoder(prefer_dense: bool = True) -> Encoder:
    """Return the best available encoder.

    Tries BGE first (per the spec), falls back to BM25 on *any* failure: missing
    package, missing model files, no internet, OOM during download, etc. We
    never raise from here — local-demo mode must always have a working encoder.
    """
    if prefer_dense:
        try:
            return BGEEncoder()
        except Exception:
            pass
    try:
        return BM25Encoder()
    except Exception as e:  # rank-bm25 is a hard dep, but be defensive.
        raise RuntimeError(
            "No encoder backend available; install rank-bm25 (uv add rank-bm25)"
        ) from e


# Helper exposed for the Retriever; lives here so encoder + reranker share the
# same simple stemming used by keyword fallbacks elsewhere in the module.
def cosine_like_blend(scores: list[float], weights: list[float]) -> list[float]:
    """Multiply each score by its weight and re-normalize to [0, 1]."""
    if not scores:
        return []
    blended = [s * w for s, w in zip(scores, weights)]
    m = max(blended) or 1.0
    return [b / m for b in blended]


def safe_log(x: float) -> float:
    """Used by callers that want a smoother distribution."""
    return math.log(1.0 + max(x, 0.0))
