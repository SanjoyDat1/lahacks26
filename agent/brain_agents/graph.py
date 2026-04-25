from __future__ import annotations

from typing import Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.prebuilt import create_react_agent

from .config import Settings, ensure_working_brain, load_settings
from .llm import make_chat_model, print_gemini_thinking
from .tools import BrainContext, build_reader_toolkit, build_writer_toolkit


READER_SYSTEM = """You are the **Reader** agent for a project brain.

There are two Markdown trees:
1. **Reference example** (`brian/` in the repo): read-only. It shows what a well-structured brain looks like (frontmatter, links, map). Use it for style and structure guidance.
2. **Working brain** (on-demand `brain/` or `BRAIN_DIR`): this is the live store. For questions, prefer reading the **working** files. Use the reference when the user asks about structure or when the working copy is empty.

You have **read** tools only (list/search/read for reference and working). Do not claim to have written files."""


WRITER_SYSTEM = """You are the **Writer** agent. You may only change the **working brain** (not the `brian/` example).

You have a single tool: `replace_working_file`, which overwrites an **existing** file. Preserve valid YAML frontmatter when you edit. Link related notes when appropriate, following the patterns in the reference example you can infer from context.

If the user request is ambiguous, ask a short clarifying question before writing. Otherwise, make the minimal edit that satisfies the request."""


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
            print_gemini_thinking(message, f"{label} message {index}")


def _prepare_user_message(
    user: str, task: Literal["query", "update"]
) -> HumanMessage:
    if task == "query":
        return HumanMessage(
            user
        )
    return HumanMessage(
        f"(Task: UPDATE working brain — not the reference.)\n\n{user}\n\n"
        "Start by listing or searching the **working** brain, then read files you need. "
        "The next step (Writer) can apply `replace_working_file` only."
    )


def run_task(
    user: str,
    task: Literal["query", "update"],
    settings: Settings | None = None,
) -> str:
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    model = make_chat_model(s)
    ctx = BrainContext(s.brian_reference_dir, s.brain_dir)

    reader = create_react_agent(
        model,
        build_reader_toolkit(ctx),
        prompt=SystemMessage(READER_SYSTEM),  # type: ignore[call-arg]
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
                    "Apply the user's request by calling `replace_working_file` on the "
                    "right existing path(s) under the working brain. If nothing should change, say so. "
                    f"Original user request: {user}"
                ),
            ]
        }
    )
    final_msgs: list[BaseMessage] = list(st2.get("messages", []))
    writer_msgs = final_msgs[len(messages) :] if len(final_msgs) >= len(messages) else final_msgs
    _print_agent_thinking(writer_msgs, "writer")
    return _last_ai_text(final_msgs) or str(st2)
