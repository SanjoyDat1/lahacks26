from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...builder import SourceDocument
from ...config import load_settings
from ...ingestion_graph import run_update_streaming
from ..rebuild_events import rebuild_event_hub
from ..schemas import ContextMapRebuildRequest, ContextMapRebuildResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/context-map/ws")
async def context_map_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    sub_id = f"ctxmap-{int(time.time() * 1000)}-{id(websocket):x}"
    sub = await rebuild_event_hub.subscribe(sub_id)
    logger.info("context-map ws connected sub_id=%s", sub_id)
    try:
        snap = await rebuild_event_hub.snapshot()
        await websocket.send_json(
            {
                "type": "connected",
                "message": "Context-map rebuild stream connected.",
                "active_run_id": snap["active_run_id"],
                "subscriber_count": snap["subscriber_count"],
            }
        )
        # Replay existing log history so clicking the popup can show current logs.
        for evt in snap["history"]:
            payload = dict(evt)
            payload["replay"] = True
            await websocket.send_json(payload)

        while True:
            evt = await sub.queue.get()
            if evt.get("type") not in {"thinking", "token"}:
                logger.info("context-map ws send sub_id=%s type=%s run_id=%s", sub_id, evt.get("type"), evt.get("run_id"))
            await websocket.send_json(evt)
    except WebSocketDisconnect:
        logger.info("context-map ws disconnect sub_id=%s", sub_id)
        return
    finally:
        await rebuild_event_hub.unsubscribe(sub_id)
        logger.info("context-map ws unsubscribed sub_id=%s", sub_id)
        try:
            await websocket.close()
        except RuntimeError:
            pass


@router.post("/context-map/rebuild", response_model=ContextMapRebuildResponse, status_code=202)
async def trigger_context_map_rebuild(req: ContextMapRebuildRequest) -> ContextMapRebuildResponse:
    """Start a rebuild from an outside trigger and broadcast logs via `/context-map/ws`."""
    run_id = f"ctxmap-{int(time.time() * 1000)}-{id(req):x}"
    loop = asyncio.get_running_loop()
    logger.info(
        "context-map rebuild trigger run_id=%s label=%s update_mode=%s text_chars=%s",
        run_id,
        req.label,
        req.update_mode,
        len(req.text or ""),
    )

    await rebuild_event_hub.start_run(
        run_id,
        meta={
            "source": req.source,
            "label": req.label,
            "update_mode": req.update_mode,
        },
    )

    def _emit_threadsafe(evt: dict[str, Any]) -> None:
        if evt.get("type") not in {"thinking", "token"}:
            logger.info("context-map rebuild emit run_id=%s type=%s", run_id, evt.get("type"))
        asyncio.run_coroutine_threadsafe(rebuild_event_hub.emit(evt), loop)

    def _end_threadsafe(status: str, summary: dict[str, Any]) -> None:
        asyncio.run_coroutine_threadsafe(
            rebuild_event_hub.end_run(run_id, status=status, summary=summary),
            loop,
        )

    def _run() -> None:
        try:
            settings = load_settings(validate=True)
            documents = [SourceDocument(name=req.label or "external-trigger", text=req.text)]

            for event in run_update_streaming(
                documents,
                settings=settings,
                update_mode=req.update_mode,
            ):
                # Ensure run_id is attached for correlation on the client.
                payload: dict[str, Any] = dict(event)
                payload.setdefault("run_id", run_id)
                _emit_threadsafe(payload)

            _emit_threadsafe({"type": "done", "run_id": run_id, "ts_ms": int(time.time() * 1000)})
            _end_threadsafe("ok", {"message": "rebuild complete"})

        except Exception as exc:  # noqa: BLE001
            logger.exception("context-map rebuild failed run_id=%s", run_id)
            err_evt = {"type": "error", "run_id": run_id, "message": str(exc), "ts_ms": int(time.time() * 1000)}
            _emit_threadsafe(err_evt)
            _end_threadsafe("error", {"message": str(exc)[:400]})

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return ContextMapRebuildResponse(ok=True, run_id=run_id)

