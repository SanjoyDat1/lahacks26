"""Section index: walk the brain, parse Markdown, persist to ``.index/``.

The on-disk JSON cache is incremental: per-file ``mtime`` is recorded, and only
files whose mtime has changed (or that are new) are re-parsed on the next
``build_index`` call. The cache is intentionally JSON (not pickle) so it stays
human-inspectable and forward-compatible across Python versions.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

from .parser import Section, parse_markdown


def _json_default(obj: Any) -> Any:
    """Serialize PyYAML's native ``date``/``datetime`` and other oddities.

    Frontmatter often contains ``updated: 2026-04-25`` which PyYAML returns as
    a ``datetime.date``. We persist as ISO 8601 string; on read it stays a
    string, which is fine — nothing in the index depends on date arithmetic.
    """
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, set):
        return sorted(obj)
    if isinstance(obj, Path):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

INDEX_DIRNAME = ".index"
INDEX_FILENAME = "sections.json"
INDEX_VERSION = 1


def _index_path(brain_root: Path) -> Path:
    return brain_root / INDEX_DIRNAME / INDEX_FILENAME


def _iter_md_files(brain_root: Path) -> Iterable[Path]:
    for p in sorted(brain_root.rglob("*.md")):
        if not p.is_file():
            continue
        # Skip any markdown stashed inside the index/audit directories.
        parts = set(p.relative_to(brain_root).parts)
        if INDEX_DIRNAME in parts or ".audit" in parts:
            continue
        yield p


def _section_to_dict(s: Section) -> dict:
    return asdict(s)


def _section_from_dict(d: dict) -> Section:
    return Section(
        file_path=d["file_path"],
        section_id=d["section_id"],
        heading=d["heading"],
        content=d["content"],
        frontmatter=d.get("frontmatter") or {},
        source_kind=d.get("source_kind"),
    )


def _load_cache(brain_root: Path) -> tuple[dict[str, float], list[Section]]:
    """Return ``(file_mtimes, cached_sections)`` from disk, or empty if absent."""
    p = _index_path(brain_root)
    if not p.is_file():
        return {}, []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}, []
    if not isinstance(data, dict) or data.get("version") != INDEX_VERSION:
        return {}, []
    mtimes_raw = data.get("file_mtimes", {})
    mtimes: dict[str, float] = {
        str(k): float(v) for k, v in mtimes_raw.items() if isinstance(v, (int, float))
    }
    sections_raw = data.get("sections", [])
    sections = [_section_from_dict(s) for s in sections_raw if isinstance(s, dict)]
    return mtimes, sections


def _save_cache(
    brain_root: Path, file_mtimes: dict[str, float], sections: list[Section]
) -> None:
    p = _index_path(brain_root)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": INDEX_VERSION,
        "file_mtimes": file_mtimes,
        "sections": [_section_to_dict(s) for s in sections],
    }
    p.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )


def build_index(brain_root: Path, *, force: bool = False) -> list[Section]:
    """Parse every ``*.md`` under ``brain_root`` into sections.

    Uses an incremental cache at ``<brain_root>/.index/sections.json``: files
    whose mtime hasn't changed are reused from the cache. Pass ``force=True``
    to bypass the cache entirely.
    """
    brain_root = brain_root.resolve()
    if not brain_root.is_dir():
        raise FileNotFoundError(f"Brain root does not exist: {brain_root}")

    cached_mtimes, cached_sections = ({}, []) if force else _load_cache(brain_root)

    sections_by_file: dict[str, list[Section]] = {}
    for sec in cached_sections:
        sections_by_file.setdefault(sec.file_path, []).append(sec)

    new_mtimes: dict[str, float] = {}
    seen_files: set[str] = set()

    for path in _iter_md_files(brain_root):
        rel = path.resolve().relative_to(brain_root).as_posix()
        seen_files.add(rel)
        mtime = path.stat().st_mtime
        new_mtimes[rel] = mtime
        if rel in sections_by_file and cached_mtimes.get(rel) == mtime:
            continue
        sections_by_file[rel] = parse_markdown(path, brain_root)

    for stale in list(sections_by_file.keys()):
        if stale not in seen_files:
            del sections_by_file[stale]

    out: list[Section] = []
    for rel in sorted(sections_by_file.keys()):
        out.extend(sections_by_file[rel])

    _save_cache(brain_root, new_mtimes, out)
    return out


def load_index(brain_root: Path) -> list[Section]:
    """Convenience wrapper that always returns a fresh-or-incremental index."""
    return build_index(brain_root)
