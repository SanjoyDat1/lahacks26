from __future__ import annotations

from typing import Any

from ..config import Settings, ensure_working_brain, load_settings
from ..graph import run_task
from ..ingestion_graph import run_initialize, run_update
from .update_modes import UpdateMode


def query(prompt: str, *, settings: Settings | None = None) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    text = run_task(user=prompt, task="query", settings=s)
    return {"result_text": text}


def bootstrap(
    prompt: str,
    sources: list[str],
    *,
    overwrite: bool = False,
    max_files: int = 3,
    settings: Settings | None = None,
) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    document_inputs = list(sources) if sources else [prompt]
    out = run_initialize(
        document_inputs,
        initial_prompt=prompt,
        settings=s,
        max_files=max_files,
        overwrite=overwrite,
    )
    return {
        "written_files": list(out.get("written_files", [])),
        "result_text": str(out.get("result_text", "")),
    }


def update(
    prompt: str,
    *,
    update_mode: UpdateMode | None = None,
    apply: bool = True,
    source: dict[str, Any] | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    s = settings or load_settings(validate=True)
    ensure_working_brain(s.brian_reference_dir, s.brain_dir)
    mode_raw = str(update_mode or getattr(s, "update_mode", "llm") or "llm").lower()
    mode: UpdateMode = "deterministic" if mode_raw == "deterministic" else "llm"
    return run_update(
        prompt,
        source=source,
        update_mode=mode,
        apply=apply,
        settings=s,
    )
