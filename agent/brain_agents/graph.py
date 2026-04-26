from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent

from .config import Settings, ensure_working_brain, load_settings
from .llm import make_chat_model, print_model_thinking
from .tools import (
    BrainContext,
    build_reader_toolkit,
    build_update_reader_toolkit,
    build_writer_toolkit,
)


READER_SYSTEM = """You are the **Reader** agent for a project brain.

There are two Markdown trees:
1. **Reference example** (`brian/` in the repo): read-only. It shows what a well-structured brain looks like (frontmatter, links, map). Use it for style and structure guidance.
2. **Working brain** (on-demand `brain/` or `BRAIN_DIR`): this is the live store. For questions, prefer reading the **working** files. Use the reference when the user asks about structure or when the working copy is empty.

You have **read** tools only (list/search/read for reference and working). Do not claim to have written files."""

UPDATE_READER_SYSTEM = """You are the **Reader** agent for an UPDATE task on a project brain.

Your only job is to gather just enough context for the Writer to make one focused change.

Rules:
- Prefer the **working** `brain/` files over the read-only `brian/` reference.
- Start with `bge_search` first. This is the preferred retrieval path and should be your default first tool call for update tasks when we want to exercise dense retrieval.
- `bge_search` uses the project's semantic retriever and reports the active backend label so we can confirm whether BGE dense retrieval is active or whether it fell back to BM25/keyword.
- Use `semantic_search` only if you need another generic semantic retrieval pass after the first `bge_search`.
- Only use `get_brief` if the task is broad and needs a bundled summary rather than a targeted lookup.
- Use `search_working_brain` or `search_reference_brain` when the prompt contains exact wording that is likely to appear verbatim (for example a known section title or exact rule text).
- Only fall back to plain text search if `bge_search` did not identify a clear target file/section.
- Read at most 3 files before stopping.
- Do not keep exploring once you have identified the likely target file(s) and relevant surrounding context.
- Return a concise handoff for the Writer instead of continuing to browse.

You have read-only tools only. Do not claim to have written files."""


WRITER_SYSTEM = """You are the **Writer** agent. You may only change the **working brain** (not the `brian/` example).

Available write tools and when to use them:
- `replace_working_file` — overwrite an **existing** file with new content.
- `upsert_working_file` — create a new file, or fully replace an existing one.
- `delete_working_file` — **permanently delete** a single `.md` file. Use this when the user says "delete", "remove", "get rid of", or "drop" a file. Do NOT use replace/upsert with empty content as a substitute.
- `delete_working_directory` — delete an entire directory and all files inside it. Use only when the user explicitly targets a whole folder.
- `move_working_file` — move or rename a file. Use when the user says "rename", "move", or "reorganise".

Rules:
- Preserve valid YAML frontmatter when editing files.
- After deleting or moving a file, check the backlink warnings returned by those tools and offer to update dangling references.
- If the user request is ambiguous, ask a short clarifying question before acting. Otherwise, make the minimal change that satisfies the request."""


def _last_ai_text(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, AIMessage) and m.content:
            c = m.content
            if isinstance(c, str):
                return c
            if isinstance(c, list) and c:
                chunks: list[str] = []
                for block in c:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = block.get("text")
                        if isinstance(text, str):
                            chunks.append(text)
                if chunks:
                    return "\n".join(chunks)
                return str(c)
    return ""


def _print_agent_thinking(messages: list[BaseMessage], label: str) -> None:
    for index, message in enumerate(messages, 1):
        if isinstance(message, AIMessage):
            print_model_thinking(message, f"{label} message {index}")


def _prepare_user_message(
    user: str, task: Literal["query", "update"]
) -> HumanMessage:
    if task == "query":
        return HumanMessage(
            user
        )
    return HumanMessage(
        f"(Task: UPDATE working brain — not the reference.)\n\n{user}\n\n"
        "Call `bge_search` first so the update flow exercises dense retrieval and reports the active backend. "
        "Use `semantic_search` only if you need a second generic semantic retrieval pass afterward. "
        "Use `get_brief` only for broad tasks. "
        "Use plain text search only if `bge_search` does not identify a clear target, or when the request includes exact words likely to appear in a heading or bullet. "
        "Read at most 3 files, identify the target note(s), then stop and hand off to the Writer. "
        "The next step (Writer) can apply `replace_working_file` or `upsert_working_file`."
    )


def _extract_content_blocks(content: object) -> tuple[list[str], list[str]]:
    """Return (text_chunks, thinking_chunks) from a message content block."""
    texts: list[str] = []
    thoughts: list[str] = []
    if isinstance(content, str):
        if content:
            texts.append(content)
    elif isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            if btype == "text":
                t = block.get("text", "")
                if t:
                    texts.append(t)
            elif btype in ("thinking", "reasoning"):
                t = block.get("thinking") or block.get("reasoning") or block.get("text", "")
                if t:
                    thoughts.append(str(t))
    return texts, thoughts


async def run_task_streaming(
    user: str,
    task: Literal["query", "update"],
    settings: Settings | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Async generator yielding structured streaming events for the agent run.

    Event shapes emitted:
    - {"type": "agent_start",  "agent": "reader"|"writer"}
    - {"type": "tool_call",    "agent": ..., "tool": ..., "input": {...}, "run_id": ...}
    - {"type": "tool_result",  "agent": ..., "tool": ..., "output": ..., "run_id": ...}
    - {"type": "token",        "agent": ..., "content": ...}
    - {"type": "thinking",     "agent": ..., "content": ...}
    - {"type": "agent_end",    "agent": ..., "text": ...}
    - {"type": "done",         "result": ...}
    - {"type": "error",        "message": ...}
    """
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    model = make_chat_model(s)
    ctx = BrainContext(s.brian_reference_dir, s.brain_dir)
    reader_prompt = UPDATE_READER_SYSTEM if task == "update" else READER_SYSTEM
    reader_tools = build_update_reader_toolkit(ctx) if task == "update" else build_reader_toolkit(ctx)

    reader = create_react_agent(
        model,
        reader_tools,
        prompt=SystemMessage(reader_prompt),  # type: ignore[call-arg]
    )
    m0 = _prepare_user_message(user, task)

    yield {"type": "agent_start", "agent": "reader"}

    final_messages: list[BaseMessage] = []

    async for event in reader.astream_events({"messages": [m0]}, version="v2"):
        etype: str = event["event"]
        ename: str = event.get("name", "")
        edata: dict[str, Any] = event.get("data", {}) or {}

        if etype == "on_tool_start":
            inp = edata.get("input") or {}
            if not isinstance(inp, dict):
                inp = {"value": str(inp)}
            yield {
                "type": "tool_call",
                "agent": "reader",
                "tool": ename,
                "input": inp,
                "run_id": event.get("run_id", ""),
            }

        elif etype == "on_tool_end":
            raw_out = edata.get("output")
            if raw_out is None:
                out_text = ""
            elif hasattr(raw_out, "content"):
                out_text = str(raw_out.content)
            else:
                out_text = str(raw_out)
            yield {
                "type": "tool_result",
                "agent": "reader",
                "tool": ename,
                "output": out_text[:3000],
                "run_id": event.get("run_id", ""),
            }

        elif etype == "on_chat_model_stream":
            chunk = edata.get("chunk")
            if chunk:
                texts, thoughts = _extract_content_blocks(chunk.content)
                for t in texts:
                    yield {"type": "token", "agent": "reader", "content": t}
                for t in thoughts:
                    yield {"type": "thinking", "agent": "reader", "content": t}

        elif etype == "on_chain_end" and ename == "LangGraph":
            out = edata.get("output") or {}
            final_messages = list(out.get("messages", []))

    reader_text = _last_ai_text(final_messages) if final_messages else ""
    yield {"type": "agent_end", "agent": "reader", "text": reader_text}

    if task == "query":
        yield {"type": "done", "result": reader_text}
        return

    # ── Writer phase ──────────────────────────────────────────────────────────
    yield {"type": "agent_start", "agent": "writer"}

    writer = create_react_agent(
        model,
        build_writer_toolkit(ctx),
        prompt=SystemMessage(WRITER_SYSTEM),  # type: ignore[call-arg]
    )

    writer_messages: list[BaseMessage] = [
        *final_messages,
        HumanMessage(
            "Apply the user's request using the appropriate tool:\n"
            "- `delete_working_file` when the user wants to DELETE or REMOVE a file — never empty a file instead of deleting it.\n"
            "- `delete_working_directory` when the user wants to remove an entire folder.\n"
            "- `move_working_file` when the user wants to RENAME or MOVE a file.\n"
            "- `replace_working_file` to edit an existing file.\n"
            "- `upsert_working_file` to create a new file.\n"
            "After a delete or move, report any dangling backlinks the tool flagged.\n"
            "If nothing should change, say so.\n"
            f"Original user request: {user}"
        ),
    ]

    final_writer_messages: list[BaseMessage] = []

    async for event in writer.astream_events({"messages": writer_messages}, version="v2"):
        etype = event["event"]
        ename = event.get("name", "")
        edata = event.get("data", {}) or {}

        if etype == "on_tool_start":
            inp = edata.get("input") or {}
            if not isinstance(inp, dict):
                inp = {"value": str(inp)}
            yield {
                "type": "tool_call",
                "agent": "writer",
                "tool": ename,
                "input": inp,
                "run_id": event.get("run_id", ""),
            }

        elif etype == "on_tool_end":
            raw_out = edata.get("output")
            if raw_out is None:
                out_text = ""
            elif hasattr(raw_out, "content"):
                out_text = str(raw_out.content)
            else:
                out_text = str(raw_out)
            yield {
                "type": "tool_result",
                "agent": "writer",
                "tool": ename,
                "output": out_text[:3000],
                "run_id": event.get("run_id", ""),
            }

        elif etype == "on_chat_model_stream":
            chunk = edata.get("chunk")
            if chunk:
                texts, thoughts = _extract_content_blocks(chunk.content)
                for t in texts:
                    yield {"type": "token", "agent": "writer", "content": t}
                for t in thoughts:
                    yield {"type": "thinking", "agent": "writer", "content": t}

        elif etype == "on_chain_end" and ename == "LangGraph":
            out = edata.get("output") or {}
            final_writer_messages = list(out.get("messages", []))

    writer_text = _last_ai_text(final_writer_messages) if final_writer_messages else ""
    yield {"type": "agent_end", "agent": "writer", "text": writer_text}
    yield {"type": "done", "result": writer_text}


def run_task(
    user: str,
    task: Literal["query", "update"],
    settings: Settings | None = None,
) -> str:
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    model = make_chat_model(s)
    ctx = BrainContext(s.brian_reference_dir, s.brain_dir)
    reader_prompt = UPDATE_READER_SYSTEM if task == "update" else READER_SYSTEM
    reader_tools = build_update_reader_toolkit(ctx) if task == "update" else build_reader_toolkit(ctx)

    reader = create_react_agent(
        model,
        reader_tools,
        prompt=SystemMessage(reader_prompt),  # type: ignore[call-arg]
    )
    m0 = _prepare_user_message(user, task)
    st = reader.invoke({"messages": [m0]})
    messages: list[BaseMessage] = list(st.get("messages", []))
    _print_agent_thinking(messages, "reader")

    if task == "query":
        return _last_ai_text(messages) or str(st)

    writer = create_react_agent(
        model,
        build_writer_toolkit(ctx),
        prompt=SystemMessage(WRITER_SYSTEM),  # type: ignore[call-arg]
    )
    st2 = writer.invoke(
        {
            "messages": [
                *messages,
                HumanMessage(
                    "Apply the user's request using the appropriate tool:\n"
                    "- `delete_working_file` when the user wants to DELETE or REMOVE a file — never empty a file instead of deleting it.\n"
                    "- `delete_working_directory` when the user wants to remove an entire folder.\n"
                    "- `move_working_file` when the user wants to RENAME or MOVE a file.\n"
                    "- `replace_working_file` to edit an existing file.\n"
                    "- `upsert_working_file` to create a new file.\n"
                    "After a delete or move, report any dangling backlinks the tool flagged.\n"
                    "If nothing should change, say so.\n"
                    f"Original user request: {user}"
                ),
            ]
        }
    )
    final_msgs: list[BaseMessage] = list(st2.get("messages", []))
    writer_msgs = final_msgs[len(messages) :] if len(final_msgs) >= len(messages) else final_msgs
    _print_agent_thinking(writer_msgs, "writer")
    return _last_ai_text(final_msgs) or str(st2)
