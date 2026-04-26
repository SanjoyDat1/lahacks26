"""Mutate ``frontmatter.links`` on the working brain (same files as ``GET /files``).

The Next.js graph calls these endpoints so drag-to-connect and edge delete persist
to the markdown the agent serves — not a forked copy under the web server cwd.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...retrieval.parser import _parse_frontmatter
from .files import BrainFile, list_brain_files

router = APIRouter()


class LinkMutationBody(BaseModel):
    sourceId: str
    targetId: str


def _find_file(files: list[BrainFile], id_or_path: str) -> BrainFile | None:
    for f in files:
        fid = f.frontmatter.get("id")
        if isinstance(fid, str) and fid == id_or_path:
            return f
        if f.path == id_or_path:
            return f
    return None


def _write_markdown_with_frontmatter(path: Path, fm: dict, body: str) -> None:
    fm_out = dict(fm)
    links = fm_out.get("links")
    if isinstance(links, list):
        fm_out["links"] = [str(x) for x in links if x is not None and str(x).strip()]
    elif links is None:
        fm_out["links"] = []
    else:
        fm_out["links"] = [str(links)]

    dump = yaml.safe_dump(
        fm_out,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    ).strip()
    body_stripped = body.strip("\n")
    if body_stripped:
        text = f"---\n{dump}\n---\n{body_stripped}\n"
    else:
        text = f"---\n{dump}\n---\n"
    path.write_text(text, encoding="utf-8", newline="\n")


def _mutate_link(source_id: str, target_id: str, action: str) -> dict:
    resp = list_brain_files()
    if resp.source != "working":
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot edit graph links on the read-only reference brain. "
                "Bootstrap a session so BRAIN_DIR contains markdown files."
            ),
        )

    root = Path(resp.brain_dir).resolve()
    files = resp.files
    source = _find_file(files, source_id)
    target = _find_file(files, target_id)
    if not source or not target:
        raise HTTPException(status_code=400, detail="Could not find source or target brain file.")
    if source_id == target_id:
        raise HTTPException(status_code=400, detail="A file cannot link to itself.")

    target_link_id = str(target.frontmatter.get("id") or target.path)
    abs_path = root / source.path
    if not abs_path.is_file():
        raise HTTPException(status_code=400, detail=f"Source file missing on disk: {source.path}")

    raw = abs_path.read_text(encoding="utf-8", errors="strict")
    fm, body = _parse_frontmatter(raw)
    if not isinstance(fm, dict):
        fm = {}

    existing = fm.get("links")
    if isinstance(existing, list):
        base = [str(x) for x in existing if x is not None and str(x)]
    else:
        base = []

    if action == "add":
        next_links = list(dict.fromkeys([*base, target_link_id]))
    else:
        next_links = [
            x
            for x in base
            if x != target_link_id and x != target.path and x != target_id
        ]

    fm["links"] = next_links
    fm["updated"] = date.today().isoformat()

    _write_markdown_with_frontmatter(abs_path, fm, body)

    source_canon = str(source.frontmatter.get("id") or source.path)
    return {
        "source": source_canon,
        "target": target_link_id,
        "sourcePath": source.path,
        "links": next_links,
    }


@router.post("/links")
def post_link(body: LinkMutationBody) -> dict:
    return {"ok": True, "result": _mutate_link(body.sourceId, body.targetId, "add")}


@router.delete("/links")
def delete_link(body: LinkMutationBody) -> dict:
    return {"ok": True, "result": _mutate_link(body.sourceId, body.targetId, "remove")}
