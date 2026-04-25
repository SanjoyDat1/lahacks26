from __future__ import annotations

import asyncio
import threading
from asyncio import Queue as AsyncQueue

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ...config import load_settings
from ...ingestion_graph import run_update_streaming
from ...services.document_parser import parse_uploaded_document
from ..schemas import UpdateStreamRequest

router = APIRouter()


def _parse_documents(req: UpdateStreamRequest):
    """Parse all uploaded documents (may block on PDF/DOCX decoding)."""
    return [
        parse_uploaded_document(
            name=doc.name,
            text=doc.text,
            content_base64=doc.content_base64,
            mime_type=doc.mime_type,
        )
        for doc in req.documents
    ]


@router.websocket("/update/ws")
async def update_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        raw = await websocket.receive_json()
        req = UpdateStreamRequest.model_validate(raw)
        if not req.documents:
            await websocket.send_json(
                {"type": "error", "message": "Upload at least one document to update the brain."}
            )
            return

        settings = load_settings(validate=True)

        # Parse documents in a thread (PDF/DOCX decoding can block)
        try:
            documents = await asyncio.to_thread(_parse_documents, req)
        except Exception as exc:
            await websocket.send_json({"type": "error", "message": f"Could not parse documents: {exc}"})
            return

        await websocket.send_json({"type": "connected", "message": "Update stream connected."})

        # Run the synchronous generator in a background thread so LLM calls
        # don't freeze the async event loop.  Events are forwarded through an
        # asyncio Queue back to the WebSocket sender.
        event_queue: AsyncQueue[dict | None] = AsyncQueue()
        loop = asyncio.get_running_loop()

        def _produce() -> None:
            try:
                for event in run_update_streaming(
                    documents,
                    settings=settings,
                    update_mode=req.update_mode,
                ):
                    loop.call_soon_threadsafe(event_queue.put_nowait, event)
            except Exception as exc:  # noqa: BLE001
                loop.call_soon_threadsafe(
                    event_queue.put_nowait,
                    {"type": "error", "message": str(exc)},
                )
            finally:
                loop.call_soon_threadsafe(event_queue.put_nowait, None)  # sentinel

        thread = threading.Thread(target=_produce, daemon=True)
        thread.start()

        while True:
            event = await event_queue.get()
            if event is None:
                break
            await websocket.send_json(event)

    except WebSocketDisconnect:
        return
    except ValidationError as exc:
        await websocket.send_json(
            {"type": "error", "message": f"Invalid update request: {exc.errors()}"}
        )
    except Exception as exc:  # noqa: BLE001
        await websocket.send_json({"type": "error", "message": str(exc)})
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass
