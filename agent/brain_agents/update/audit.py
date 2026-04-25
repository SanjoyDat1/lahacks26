"""Append-only JSON-lines audit log for reconciliation plans.

Every reconcile() call writes one entry to ``<brain_root>/.audit/log.jsonl``.
Entries are pure JSON, one per line, so they can be replayed, diffed, or
filtered with normal text tooling. The log is the single source of truth for
"what would have changed and why" -- it is written *before* any file is
mutated, which lets the system survive a crash or human override.

The class is small on purpose: it does file IO + a timestamp. No locking,
no rotation, no schema enforcement beyond requiring ``dict`` entries. If
contention or size becomes a problem we can swap to SQLite, but for the
hackathon the JSONL footprint is enough.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


class AuditLog:
    """File-backed append-only log, one JSON object per line.

    The log lives at ``<brain_root>/.audit/log.jsonl`` (the directory is
    created on demand). Entries are wrapped with an ISO-8601 UTC timestamp
    if the caller did not provide one.
    """

    LOG_REL = ".audit/log.jsonl"

    def __init__(self, brain_root: Path | str) -> None:
        self.brain_root: Path = Path(brain_root).resolve()
        self.log_path: Path = self.brain_root / self.LOG_REL

    def _ensure_dir(self) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _coerce(entry: Any) -> dict[str, Any]:
        if isinstance(entry, dict):
            return dict(entry)
        if is_dataclass(entry):
            return asdict(entry)
        if hasattr(entry, "to_dict") and callable(entry.to_dict):
            out = entry.to_dict()
            if isinstance(out, dict):
                return out
        raise TypeError(f"AuditLog entry must be dict-like, got {type(entry).__name__}")

    def append(self, entry: Any) -> dict[str, Any]:
        """Write one entry; returns the (timestamp-stamped) dict actually written."""
        payload = self._coerce(entry)
        payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        self._ensure_dir()
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        return payload

    def entries(self, since: datetime | None = None) -> list[dict[str, Any]]:
        """Read all entries (optionally filtered by timestamp >= ``since``).

        Malformed lines are skipped silently rather than raising -- the log is
        meant to remain readable even if a partial write happened.
        """
        if not self.log_path.is_file():
            return []
        out: list[dict[str, Any]] = []
        cutoff = self._normalize_since(since)
        with self.log_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                if cutoff is not None and not self._after(obj, cutoff):
                    continue
                out.append(obj)
        return out

    @staticmethod
    def _normalize_since(since: datetime | None) -> datetime | None:
        if since is None:
            return None
        if since.tzinfo is None:
            return since.replace(tzinfo=timezone.utc)
        return since

    @staticmethod
    def _after(obj: dict[str, Any], cutoff: datetime) -> bool:
        ts = obj.get("timestamp")
        if not ts:
            return True
        try:
            parsed = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            return True
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed >= cutoff

    def iter_entries(self, since: datetime | None = None) -> Iterable[dict[str, Any]]:
        """Streaming variant of :meth:`entries` for very large logs."""
        if not self.log_path.is_file():
            return
        cutoff = self._normalize_since(since)
        with self.log_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                if cutoff is not None and not self._after(obj, cutoff):
                    continue
                yield obj


__all__ = ["AuditLog"]
