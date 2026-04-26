from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...builder import SourceDocument
from ...config import load_settings
from ...graph import run_task_streaming
from ...ingestion_graph import run_update_streaming
from ..rebuild_events import rebuild_event_hub
from ..schemas import (
    ContextMapRebuildAgentRequest,
    ContextMapRebuildAgentResponse,
    ContextMapRebuildRequest,
    ContextMapRebuildResponse,
)

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


@router.post(
    "/context-map/rebuild-agent",
    response_model=ContextMapRebuildAgentResponse,
    status_code=202,
)
async def trigger_context_map_rebuild_agent(
    req: ContextMapRebuildAgentRequest,
) -> ContextMapRebuildAgentResponse:
    """Run the full LLM agent UPDATE flow and broadcast its logs to `/context-map/ws`."""
    run_id = f"ctxmap-agent-{int(time.time() * 1000)}-{id(req):x}"
    logger.info(
        "context-map rebuild-agent trigger run_id=%s label=%s prompt_chars=%s",
        run_id,
        req.label,
        len(req.prompt or ""),
    )

    await rebuild_event_hub.start_run(
        run_id,
        meta={
            "source": req.source,
            "label": req.label,
            "mode": "agent_update",
        },
    )

    async def _run() -> None:
        try:
            settings = load_settings(validate=True)
            async for evt in run_task_streaming(req.prompt, task="update", settings=settings):
                payload = dict(evt)
                payload.setdefault("run_id", run_id)
                if payload.get("type") not in {"token", "thinking"}:
                    logger.info(
                        "context-map rebuild-agent emit run_id=%s type=%s agent=%s tool=%s",
                        run_id,
                        payload.get("type"),
                        payload.get("agent"),
                        payload.get("tool"),
                    )
                await rebuild_event_hub.emit(payload)

            await rebuild_event_hub.end_run(run_id, status="ok", summary={"message": "agent update complete"})
        except Exception as exc:  # noqa: BLE001
            logger.exception("context-map rebuild-agent failed run_id=%s", run_id)
            await rebuild_event_hub.emit(
                {"type": "error", "run_id": run_id, "message": str(exc), "ts_ms": int(time.time() * 1000)}
            )
            await rebuild_event_hub.end_run(run_id, status="error", summary={"message": str(exc)[:400]})

    asyncio.create_task(_run())
    return ContextMapRebuildAgentResponse(ok=True, run_id=run_id)

