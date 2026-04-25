"""Retrieval module for the project brain.

Exports a :class:`Retriever` that performs two-stage semantic search over a
Markdown brain (`brian/` reference or `brain/` working copy) and returns
ranked :class:`RetrievalHit` objects with token-aware packing.

Designed to be importable even when optional ML dependencies
(``sentence-transformers``, ``tiktoken``) are unavailable: the implementation
falls back to BM25 + keyword reranking + heuristic token estimation.
"""

from .retriever import RetrievalHit, Retriever

__all__ = ["Retriever", "RetrievalHit"]
