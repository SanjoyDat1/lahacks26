"""Expose the live brain file tree as JSON.

The frontend's force-directed knowledge graph needs to reflect what the
*connected* agent currently has on disk, not whatever happens to be in the
Next.js process's working directory. This endpoint is the source of truth:
it walks the agent's resolved brain root and returns the same shape the
frontend already understands ({ path, content, frontmatter }).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ...config import load_settings
from ...retrieval.parser import _parse_frontmatter

router = APIRouter()


class BrainFile(BaseModel):
    path: str
    content: str
    frontmatter: dict[str, Any]


class BrainFilesResponse(BaseModel):
    brain_dir: str
    source: str  # "working" | "reference"
    files: list[BrainFile]


def _active_brain_root() -> tuple[Path, str]:
    s = load_settings(validate=False)
    if s.brain_dir.is_dir() and any(s.brain_dir.rglob("*.md")):
        return s.brain_dir, "working"
    return s.brian_reference_dir, "reference"


def _coerce_jsonable(value: Any) -> Any:
    """YAML can produce datetime / date objects that aren't JSON-serializable.

    Mirror what the frontend's gray-matter path does: stringify dates as
    ISO YYYY-MM-DD so frontmatter shape stays predictable.
    """
    import datetime as _dt

    if isinstance(value, (_dt.datetime, _dt.date)):
        return value.isoformat()[:10]
    if isinstance(value, dict):
        return {str(k): _coerce_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_coerce_jsonable(v) for v in value]
    if isinstance(value, tuple):
        return [_coerce_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


@router.get("/files", response_model=BrainFilesResponse)
def list_brain_files() -> BrainFilesResponse:
    root, source = _active_brain_root()
    root = root.resolve()

    files: list[BrainFile] = []
    if root.is_dir():
        for path in sorted(root.rglob("*.md")):
            # Skip hidden / index folders (.audit, .index, etc.)
            if any(part.startswith(".") for part in path.relative_to(root).parts):
                continue
            try:
                raw = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            fm, body = _parse_frontmatter(raw)
            rel = path.relative_to(root).as_posix()
            files.append(
                BrainFile(
                    path=rel,
                    content=body,
                    frontmatter=_coerce_jsonable(fm) if isinstance(fm, dict) else {},
                )
            )

    return BrainFilesResponse(brain_dir=str(root), source=source, files=files)
