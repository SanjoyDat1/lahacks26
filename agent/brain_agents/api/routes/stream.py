from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ...config import load_settings
from ...graph import run_task_streaming
from ..schemas import StreamRequest

router = APIRouter()


@router.post("/stream")
async def stream_agent(req: StreamRequest) -> StreamingResponse:
    """Stream agent execution as Server-Sent Events.

    Each event is a JSON object with at minimum a ``type`` field:
    - agent_start  / agent_end
    - tool_call    / tool_result
    - token        / thinking
    - done         / error
    """

    async def event_generator():
        try:
            settings = load_settings(validate=True)
            async for evt in run_task_streaming(
                req.prompt, task=req.task, settings=settings
            ):
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            err_payload = json.dumps({"type": "error", "message": str(exc)})
            yield f"data: {err_payload}\n\n"
        finally:
            yield 'data: {"type":"stream_end"}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/tools")
async def list_tools() -> dict:
    """Return the tool schema for the reader and writer agents (for visualization)."""
    reader_tools = [
        "list_reference_brain",
        "read_reference_file",
        "search_reference_brain",
        "list_working_brain",
        "read_working_file",
        "search_working_brain",
        "get_working_frontmatter",
        "semantic_search",
        "get_brief",
    ]
    writer_tools = [
        "upsert_working_file",
        "replace_working_file",
        "propose_update",
        "record_audit",
    ]
    return {
        "reader": reader_tools,
        "writer": writer_tools,
        "graph": {
            "nodes": [
                {"id": "__start__", "label": "Start", "kind": "system"},
                {"id": "reader_agent", "label": "Reader Agent", "kind": "agent", "role": "reader"},
                {"id": "writer_agent", "label": "Writer Agent", "kind": "agent", "role": "writer"},
                {"id": "__end__", "label": "End", "kind": "system"},
                *[{"id": t, "label": t.replace("_", " ").title(), "kind": "tool", "role": "reader"} for t in reader_tools],
                *[{"id": t, "label": t.replace("_", " ").title(), "kind": "tool", "role": "writer"} for t in writer_tools],
            ],
            "edges": [
                {"source": "__start__", "target": "reader_agent"},
                *[{"source": "reader_agent", "target": t} for t in reader_tools],
                *[{"source": t, "target": "reader_agent"} for t in reader_tools],
                {"source": "reader_agent", "target": "writer_agent", "label": "update only"},
                {"source": "reader_agent", "target": "__end__", "label": "query"},
                *[{"source": "writer_agent", "target": t} for t in writer_tools],
                *[{"source": t, "target": "writer_agent"} for t in writer_tools],
                {"source": "writer_agent", "target": "__end__"},
            ],
        },
    }
