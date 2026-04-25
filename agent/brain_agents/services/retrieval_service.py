from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from threading import RLock
from typing import Any

from ..retrieval import RetrievalHit, Retriever


class RetrievalService:
    """Owns retriever caching + reload for long-running processes."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._cache: dict[str, Retriever] = {}

    def _key(self, brain_root: Path) -> str:
        return str(Path(brain_root).resolve())

    def get(self, brain_root: Path) -> Retriever:
        key = self._key(brain_root)
        with self._lock:
            r = self._cache.get(key)
            if r is None:
                r = Retriever(brain_root=Path(brain_root))
                self._cache[key] = r
            return r

    def reload(self, brain_root: Path) -> Retriever:
        key = self._key(brain_root)
        with self._lock:
            r = Retriever(brain_root=Path(brain_root))
            self._cache[key] = r
            return r

    def invalidate(self, brain_root: Path) -> None:
        key = self._key(brain_root)
        with self._lock:
            self._cache.pop(key, None)

    @staticmethod
    def hit_to_dict(hit: RetrievalHit) -> dict[str, Any]:
        d = asdict(hit)
        return d


retrieval_service = RetrievalService()

