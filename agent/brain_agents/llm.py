from __future__ import annotations

from langchain_openai import ChatOpenAI

from .config import Settings


def make_chat_model(settings: Settings) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.openrouter_model,
        openai_api_key=settings.openrouter_api_key,
        openai_api_base=settings.openrouter_base_url,
        default_headers={"HTTP-Referer": "https://github.com/local/brain-agent"},
        model_kwargs={},
    )
