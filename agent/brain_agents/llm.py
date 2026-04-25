from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from langchain_core.messages import BaseMessage

from .config import Settings


def make_chat_model(settings: Settings):
    """Return a LangChain chat model based on available API keys.

    Priority: OpenAI (if OPENAI_API_KEY is set) → Gemini (GEMINI_API_KEY).
    """
    if settings.provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,  # type: ignore[arg-type]
            temperature=0,
            streaming=True,
        )

    # Gemini fallback
    from langchain_google_genai import ChatGoogleGenerativeAI

    kwargs: dict[str, Any] = {
        "model": settings.gemini_model,
        "google_api_key": settings.gemini_api_key,
        "include_thoughts": settings.gemini_include_thoughts,
    }
    if "2.5" in settings.gemini_model:
        kwargs["thinking_budget"] = settings.gemini_thinking_budget
    return ChatGoogleGenerativeAI(**kwargs)


def _extract_thinking_blocks(content: object) -> list[str]:
    if not isinstance(content, list):
        return []

    blocks: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type not in {"thinking", "reasoning"}:
            continue
        text = block.get("thinking") or block.get("reasoning") or block.get("text")
        if isinstance(text, str) and text.strip():
            blocks.append(text.strip())
    return blocks


def print_model_thinking(response: object, label: str) -> None:
    """Print thinking/reasoning summaries when the model returns them."""
    thoughts = _extract_thinking_blocks(getattr(response, "content", None))
    usage = getattr(response, "usage_metadata", None) or {}
    output_details = usage.get("output_token_details", {}) if isinstance(usage, dict) else {}
    reasoning_tokens = output_details.get("reasoning") if isinstance(output_details, dict) else None

    if not thoughts and not reasoning_tokens:
        return

    print(f"\n== Model Thinking: {label} ==")
    for index, thought in enumerate(thoughts, 1):
        print(f"[thought {index}] {thought}")
    if reasoning_tokens:
        print(f"[reasoning tokens] {reasoning_tokens}")


# Keep old name as alias for backward compat
print_gemini_thinking = print_model_thinking


def invoke_chat_model(
    model: Any,
    messages: Sequence[BaseMessage],
    *,
    label: str,
) -> object:
    response = model.invoke(messages)
    print_model_thinking(response, label)
    return response
