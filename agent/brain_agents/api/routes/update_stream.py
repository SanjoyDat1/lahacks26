from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ...config import load_settings
from ...ingestion_graph import run_update_streaming
from ...services.document_parser import parse_uploaded_document
from ..schemas import UpdateStreamRequest

router = APIRouter()


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
        documents = [
            parse_uploaded_document(
                name=doc.name,
                text=doc.text,
                content_base64=doc.content_base64,
                mime_type=doc.mime_type,
            )
            for doc in req.documents
        ]

        await websocket.send_json({"type": "connected", "message": "Update stream connected."})
        for event in run_update_streaming(
            documents,
            settings=settings,
            update_mode=req.update_mode,
        ):
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
