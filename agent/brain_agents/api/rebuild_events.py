from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Subscriber:
    id: str
    queue: "asyncio.Queue[dict]"


class RebuildEventHub:
    """In-memory pub/sub for context-map rebuild streams.

    - Multiple WebSocket clients can subscribe.
    - A single active run is tracked with bounded event history for late joiners.
    - Broadcast is best-effort; slow subscribers will drop events.
    """

    def __init__(self, *, max_history: int = 800, max_queue: int = 200) -> None:
        self._lock = asyncio.Lock()
        self._subs: dict[str, Subscriber] = {}
        self._active_run_id: str | None = None
        self._active_started_at_ms: int | None = None
        self._history: list[dict[str, Any]] = []
        self._max_history = int(max_history)
        self._max_queue = int(max_queue)

    async def subscribe(self, sub_id: str) -> Subscriber:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=self._max_queue)
        sub = Subscriber(id=sub_id, queue=q)
        async with self._lock:
            self._subs[sub_id] = sub
        return sub

    async def unsubscribe(self, sub_id: str) -> None:
        async with self._lock:
            self._subs.pop(sub_id, None)

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            return {
                "active_run_id": self._active_run_id,
                "active_started_at_ms": self._active_started_at_ms,
                "history": list(self._history),
                "subscriber_count": len(self._subs),
            }

    async def start_run(self, run_id: str, *, meta: dict[str, Any] | None = None) -> None:
        evt = {
            "type": "rebuild_started",
            "run_id": run_id,
            "ts_ms": int(time.time() * 1000),
            "meta": meta or {},
        }
        async with self._lock:
            self._active_run_id = run_id
            self._active_started_at_ms = int(evt["ts_ms"])
            self._history = [evt]
        await self.broadcast(evt)

    async def end_run(self, run_id: str, *, status: str, summary: dict[str, Any] | None = None) -> None:
        evt = {
            "type": "rebuild_end",
            "run_id": run_id,
            "status": status,
            "summary": summary or {},
            "ts_ms": int(time.time() * 1000),
        }
        await self.emit(evt)

    async def emit(self, evt: dict[str, Any]) -> None:
        async with self._lock:
            self._history.append(evt)
            if len(self._history) > self._max_history:
                self._history = self._history[-self._max_history :]
        await self.broadcast(evt)

    async def broadcast(self, evt: dict[str, Any]) -> None:
        async with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            try:
                sub.queue.put_nowait(evt)
            except asyncio.QueueFull:
                # Best-effort: drop event for this subscriber only.
                continue


rebuild_event_hub = RebuildEventHub()

