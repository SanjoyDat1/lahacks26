from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List

import yaml
from langchain_core.tools import tool


@dataclass(frozen=True, slots=True)
class BrainContext:
    """Read-only example (`brian/`) + writable working brain (`brain/` on demand)."""

    reference: Path
    working: Path


def _assert_under(root: Path, p: Path) -> Path:
    root = root.resolve()
    p = p.resolve()
    p.relative_to(root)
    return p


def _safe_join(root: Path, relative: str) -> Path:
    rel = relative.replace("\\", "/").strip()
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        raise ValueError("Invalid path")
    p = (root / rel).resolve()
    _assert_under(root, p)
    return p


def _iter_markdown_files(root: Path) -> list[str]:
    root = root.resolve()
    out: list[str] = []
    for f in sorted(root.rglob("*.md")):
        if f.is_file():
            out.append(str(f.relative_to(root)).replace("\\", "/"))
    return out


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _parse_frontmatter_and_body(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return {}, text
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.DOTALL)
    if not m:
        return {}, text
    raw = m.group(1)
    try:
        fm = yaml.safe_load(raw) or {}
    except Exception:
        fm = {}
    body = text[m.end() :]
    if not isinstance(fm, dict):
        fm = {}
    return fm, body


def build_all_tools(ctx: BrainContext) -> list:
    ref, wk = ctx.reference, ctx.working

    @tool
    def list_reference_brain() -> str:
        """List Markdown files under the read-only `brian/` example (what a real brain should look like)."""
        if not ref.is_dir():
            return f"Reference directory missing: {ref}"
        return "\n".join(_iter_markdown_files(ref)) or "(no .md files)"

    @tool
    def read_reference_file(relative_path: str) -> str:
        """Read one Markdown file from the read-only example `brian/` by path relative to that root."""
        p = _safe_join(ref, relative_path)
        if not p.is_file():
            return f"File not found: {relative_path}"
        return _read_text(p)

    @tool
    def search_reference_brain(needle: str) -> str:
        """Case-insensitive search across the example `brian/` files (path:line: snippet)."""
        if not ref.is_dir():
            return f"Reference directory missing: {ref}"
        needle_l = needle.lower()
        lines_out: list[str] = []
        for rel in _iter_markdown_files(ref):
            text = _read_text(ref / rel)
            for i, line in enumerate(text.splitlines(), 1):
                if needle_l in line.lower():
                    lines_out.append(f"{rel}:{i}: {line.strip()[:300]}")
                    if len(lines_out) >= 30:
                        return "\n".join(lines_out) + "\n... truncated ..."
        return "\n".join(lines_out) or "(no matches)"

    @tool
    def list_working_brain() -> str:
        """List Markdown files under the on-demand working brain (default `../brain/`)."""
        if not wk.is_dir():
            return f"Working brain missing: {wk}. Bootstrap was not run."
        return "\n".join(_iter_markdown_files(wk)) or "(no .md files)"

    @tool
    def read_working_file(relative_path: str) -> str:
        """Read a Markdown file from the working brain by path relative to that root."""
        p = _safe_join(wk, relative_path)
        if not p.is_file():
            return f"File not found: {relative_path}"
        return _read_text(p)

    @tool
    def search_working_brain(needle: str) -> str:
        """Search the working brain for a substring; returns path:line: snippet."""
        if not wk.is_dir():
            return f"Working brain missing: {wk}"
        needle_l = needle.lower()
        lines_out: list[str] = []
        for rel in _iter_markdown_files(wk):
            text = _read_text(wk / rel)
            for i, line in enumerate(text.splitlines(), 1):
                if needle_l in line.lower():
                    lines_out.append(f"{rel}:{i}: {line.strip()[:300]}")
                    if len(lines_out) >= 30:
                        return "\n".join(lines_out) + "\n... truncated ..."
        return "\n".join(lines_out) or "(no matches)"

    @tool
    def get_working_frontmatter(relative_path: str) -> str:
        """Return parsed YAML frontmatter (if any) for a file in the working brain."""
        p = _safe_join(wk, relative_path)
        if not p.is_file():
            return f"File not found: {relative_path}"
        fm, _ = _parse_frontmatter_and_body(_read_text(p))
        if not fm:
            return "(no frontmatter)"
        return yaml.dump(fm, default_flow_style=False, sort_keys=True)

    @tool
    def replace_working_file(relative_path: str, new_content: str) -> str:
        """
        Replace the full contents of an **existing** Markdown file in the working brain.
        The working tree is bootstrapped from the example; this tool does not create new files.
        """
        p = _safe_join(wk, relative_path)
        if not p.is_file():
            return f"Refuse: file does not exist: {relative_path}"
        if p.suffix.lower() != ".md":
            return "Refuse: only .md files are allowed"
        p.write_text(new_content, encoding="utf-8")
        return f"Wrote {relative_path} ({len(new_content)} chars)."

    return [
        list_reference_brain,
        read_reference_file,
        search_reference_brain,
        list_working_brain,
        read_working_file,
        search_working_brain,
        get_working_frontmatter,
        replace_working_file,
    ]


def build_reader_toolkit(ctx: BrainContext) -> list:
    """All tools except the write tool."""
    return [t for t in build_all_tools(ctx) if t.name != "replace_working_file"]


def build_writer_toolkit(ctx: BrainContext) -> list:
    """Write tool only."""
    return [t for t in build_all_tools(ctx) if t.name == "replace_working_file"]
