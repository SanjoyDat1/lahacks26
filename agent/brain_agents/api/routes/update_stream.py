from __future__ import annotations

import asyncio
import subprocess
import threading
from asyncio import Queue as AsyncQueue

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ...builder import SourceDocument
from ...config import load_settings
from ...ingestion_graph import run_update_streaming
from ...services.document_parser import parse_uploaded_document
from ...services.github_ingest import github_repo_as_source_document
from ..schemas import UpdateStreamRequest

router = APIRouter()


def _parse_uploaded_only(req: UpdateStreamRequest):
    """Parse uploaded browser documents (may block on PDF/DOCX decoding)."""
    return [
        parse_uploaded_document(
            name=doc.name,
            text=doc.text,
            content_base64=doc.content_base64,
            mime_type=doc.mime_type,
        )
        for doc in req.documents
    ]


def _collect_update_source_documents(req: UpdateStreamRequest) -> list[SourceDocument]:
    """Merge file uploads and GitHub repo context into one document list (blocking)."""
    parts: list[SourceDocument] = []
    if req.documents:
        parts.extend(_parse_uploaded_only(req))
    for repo in req.github_repos:
        parts.append(
            github_repo_as_source_document(
                repo.repo_url,
                ref=repo.ref,
                include_globs=repo.include_globs or None,
                exclude_globs=repo.exclude_globs or None,
                max_files=repo.max_files,
                max_chars=repo.max_chars,
                clone_timeout_s=req.clone_timeout_s,
            )
        )
    return parts


@router.websocket("/update/ws")
async def update_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        raw = await websocket.receive_json()
        req = UpdateStreamRequest.model_validate(raw)

        settings = load_settings(validate=True)

        if req.github_repos:
            await websocket.send_json(
                {
                    "type": "thinking",
                    "content": "Cloning and scanning public GitHub repositories for this update…\n",
                }
            )

        try:
            documents = await asyncio.to_thread(_collect_update_source_documents, req)
        except ValueError as exc:
            await websocket.send_json({"type": "error", "message": str(exc)})
            return
        except subprocess.TimeoutExpired as exc:
            await websocket.send_json(
                {"type": "error", "message": f"Git operation timed out: {exc}"},
            )
            return
        except subprocess.CalledProcessError as exc:
            err = (exc.stderr or exc.stdout or str(exc)).strip()
            await websocket.send_json(
                {"type": "error", "message": f"Git failed: {err[:2000]}"},
            )
            return
        except Exception as exc:  # noqa: BLE001
            await websocket.send_json({"type": "error", "message": f"Could not prepare context: {exc}"})
            return

        if not documents:
            await websocket.send_json(
                {"type": "error", "message": "No readable documents were provided."}
            )
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
