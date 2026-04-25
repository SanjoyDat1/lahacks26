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

    def _key(
        self,
        brain_root: Path,
        *,
        prefer_dense: bool = True,
        prefer_cross_encoder: bool = True,
    ) -> str:
        root = Path(brain_root).resolve()
        return f"{root}|dense={prefer_dense}|cross={prefer_cross_encoder}"

    def get(
        self,
        brain_root: Path,
        *,
        prefer_dense: bool = True,
        prefer_cross_encoder: bool = True,
    ) -> Retriever:
        key = self._key(
            brain_root,
            prefer_dense=prefer_dense,
            prefer_cross_encoder=prefer_cross_encoder,
        )
        with self._lock:
            r = self._cache.get(key)
            if r is None:
                r = Retriever(
                    brain_root=Path(brain_root),
                    prefer_dense=prefer_dense,
                    prefer_cross_encoder=prefer_cross_encoder,
                )
                self._cache[key] = r
            return r

    def reload(
        self,
        brain_root: Path,
        *,
        prefer_dense: bool = True,
        prefer_cross_encoder: bool = True,
    ) -> Retriever:
        key = self._key(
            brain_root,
            prefer_dense=prefer_dense,
            prefer_cross_encoder=prefer_cross_encoder,
        )
        with self._lock:
            r = Retriever(
                brain_root=Path(brain_root),
                prefer_dense=prefer_dense,
                prefer_cross_encoder=prefer_cross_encoder,
            )
            self._cache[key] = r
            return r

    def invalidate(self, brain_root: Path) -> None:
        root = str(Path(brain_root).resolve())
        with self._lock:
            for key in list(self._cache):
                if key == root or key.startswith(f"{root}|"):
                    self._cache.pop(key, None)

    @staticmethod
    def hit_to_dict(hit: RetrievalHit) -> dict[str, Any]:
        d = asdict(hit)
        return d


retrieval_service = RetrievalService()

