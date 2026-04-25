from __future__ import annotations

import asyncio
import subprocess

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ...builder import SourceDocument
from ...config import load_settings
from ...ingestion_graph import run_initialize_streaming
from ...services.document_parser import parse_uploaded_document
from ...services.github_ingest import github_repo_as_source_document
from ..schemas import BootstrapStreamRequest

router = APIRouter()


def _collect_bootstrap_source_documents(req: BootstrapStreamRequest) -> list[SourceDocument]:
    """Parse uploads and clone GitHub repos into ``SourceDocument`` rows (blocking)."""
    out: list[SourceDocument] = []
    for doc in req.documents:
        out.append(
            parse_uploaded_document(
                name=doc.name,
                text=doc.text,
                content_base64=doc.content_base64,
                mime_type=doc.mime_type,
            )
        )
    for repo in req.github_repos:
        out.append(
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
    return out


@router.websocket("/bootstrap/ws")
async def bootstrap_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        raw = await websocket.receive_json()
        req = BootstrapStreamRequest.model_validate(raw)

        settings = load_settings(validate=True)

        if req.github_repos:
            await websocket.send_json(
                {
                    "type": "thinking",
                    "content": "Cloning and scanning public GitHub repositories (this can take a minute)…\n",
                }
            )

        try:
            documents = await asyncio.to_thread(_collect_bootstrap_source_documents, req)
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
