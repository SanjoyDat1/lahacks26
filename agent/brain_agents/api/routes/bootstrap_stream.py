from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ...config import load_settings
from ...ingestion_graph import run_initialize_streaming
from ...services.document_parser import parse_uploaded_document
from ..schemas import BootstrapStreamRequest

router = APIRouter()


@router.websocket("/bootstrap/ws")
async def bootstrap_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        raw = await websocket.receive_json()
        req = BootstrapStreamRequest.model_validate(raw)
        if not req.documents:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Upload at least one readable document to create a session.",
                }
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

        await websocket.send_json(
            {
                "type": "connected",
                "message": "Bootstrap stream connected.",
            }
        )
        for event in run_initialize_streaming(
            documents,
            initial_prompt=req.prompt,
            settings=settings,
            max_files=req.max_files,
            overwrite=req.overwrite,
        ):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        return
    except ValidationError as exc:
        await websocket.send_json(
            {
                "type": "error",
                "message": f"Invalid bootstrap request: {exc.errors()}",
            }
        )
    except Exception as exc:  # noqa: BLE001 - surface demo-time failures to the client.
        await websocket.send_json({"type": "error", "message": str(exc)})
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass
