from __future__ import annotations

import itertools
import logging
import sys
import time
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import BaseMessage

from .config import Settings

logger = logging.getLogger(__name__)
_REQUEST_COUNTER = itertools.count(1)


def _log_progress(message: str) -> None:
    logger.info(message)
    print(f"[brain-agent] {message}", file=sys.stderr, flush=True)


def _model_name(model: object) -> str:
    for attr in ("model", "model_name", "name"):
        value = getattr(model, attr, None)
        if isinstance(value, str) and value:
            return value
    return type(model).__name__


def _message_text_size(message: BaseMessage) -> int:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        return sum(len(str(part)) for part in content)
    return len(str(content))


def _usage_summary(response: object) -> str:
    usage = getattr(response, "usage_metadata", None)
    if not isinstance(usage, dict) or not usage:
        return "usage=unavailable"

    parts: list[str] = []
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        value = usage.get(key)
        if value is not None:
            parts.append(f"{key}={value}")

    output_details = usage.get("output_token_details")
    if isinstance(output_details, dict) and output_details.get("reasoning") is not None:
        parts.append(f"reasoning_tokens={output_details['reasoning']}")

    return ", ".join(parts) if parts else f"usage={usage}"


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
    request_id = next(_REQUEST_COUNTER)
    model_name = _model_name(model)
    prompt_chars = sum(_message_text_size(message) for message in messages)
    started = time.monotonic()
    _log_progress(
        f"Gemini request {request_id} START label={label!r} model={model_name} "
        f"messages={len(messages)} prompt_chars={prompt_chars}"
    )
    try:
        response = model.invoke(messages)
    except Exception as exc:
        elapsed = time.monotonic() - started
        _log_progress(
            f"Gemini request {request_id} FAILED label={label!r} "
            f"elapsed={elapsed:.2f}s error_type={type(exc).__name__} error={exc}"
        )
        raise

    elapsed = time.monotonic() - started
    _log_progress(
        f"Gemini request {request_id} END label={label!r} "
        f"elapsed={elapsed:.2f}s {_usage_summary(response)}"
    )
    print_model_thinking(response, label)
    return response
