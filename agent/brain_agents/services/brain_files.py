from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


def _safe_join(root: Path, relative: str) -> Path:
    rel = relative.replace("\\", "/").strip()
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        raise ValueError("Invalid path")
    p = (root / rel).resolve()
    p.relative_to(root.resolve())
    return p


def _slugify_heading(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"[^\w\s-]", "", t)
    t = re.sub(r"\s+", "-", t)
    t = re.sub(r"-{2,}", "-", t).strip("-")
    return t


@dataclass(frozen=True)
class ApplyResult:
    applied_ops: int
    files_touched: set[str]


OperationKind = Literal["append", "supersede", "flag_conflict", "ignore", "create_section"]


def append_to_section(
    *,
    brain_root: Path,
    target_file: str,
    target_section_id: str | None,
    new_content: str,
) -> bool:
    """Append content to an existing file, preferably under a heading if resolvable.

    This is intentionally deterministic + conservative. If we can't confidently
    locate the target heading, we append to the end of the file under an
    'Updates' heading.
    """
    file_path = _safe_join(brain_root, target_file)
    if not file_path.is_file():
        return False

    text = file_path.read_text(encoding="utf-8", errors="replace")
    insertion = new_content.rstrip() + "\n"

    heading_slug = None
    if target_section_id and "#" in target_section_id:
        heading_slug = target_section_id.split("#", 1)[1].strip()

    if heading_slug:
        # Best-effort: find a Markdown heading whose slug matches.
        lines = text.splitlines(keepends=True)
        for i, line in enumerate(lines):
            m = re.match(r"^(#{1,6})\s+(.*)\s*$", line.rstrip("\n"))
            if not m:
                continue
            heading_text = m.group(2).strip()
            if _slugify_heading(heading_text) == heading_slug:
                # Insert after the heading block, before next heading of same/higher level.
                level = len(m.group(1))
                j = i + 1
                while j < len(lines):
                    m2 = re.match(r"^(#{1,6})\s+.*\s*$", lines[j].rstrip("\n"))
                    if m2 and len(m2.group(1)) <= level:
                        break
                    j += 1
                lines.insert(j, "\n" + insertion if (j > 0 and not lines[j - 1].endswith("\n\n")) else insertion)
                file_path.write_text("".join(lines), encoding="utf-8")
                return True

    # Fallback: append under an Updates heading at end.
    suffix = "\n## Updates\n\n" + insertion
    file_path.write_text(text.rstrip() + suffix, encoding="utf-8")
    return True


def replace_section_block(
    *,
    brain_root: Path,
    target_file: str,
    target_section_id: str | None,
    new_block: str,
) -> bool:
    """Replace the content of a section by heading slug; fallback to append."""
    file_path = _safe_join(brain_root, target_file)
    if not file_path.is_file():
        return False

    text = file_path.read_text(encoding="utf-8", errors="replace")
    heading_slug = None
    if target_section_id and "#" in target_section_id:
        heading_slug = target_section_id.split("#", 1)[1].strip()
    if not heading_slug:
        file_path.write_text(text.rstrip() + "\n\n" + new_block.rstrip() + "\n", encoding="utf-8")
        return True

    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.*)\s*$", line.rstrip("\n"))
        if not m:
            continue
        heading_text = m.group(2).strip()
        if _slugify_heading(heading_text) != heading_slug:
            continue
        level = len(m.group(1))
        j = i + 1
        while j < len(lines):
            m2 = re.match(r"^(#{1,6})\s+.*\s*$", lines[j].rstrip("\n"))
            if m2 and len(m2.group(1)) <= level:
                break
            j += 1
        # Replace section body (keep heading line).
        new_lines = [*lines[: i + 1], "\n", new_block.rstrip() + "\n", "\n", *lines[j:]]
        file_path.write_text("".join(new_lines), encoding="utf-8")
        return True

    file_path.write_text(text.rstrip() + "\n\n" + new_block.rstrip() + "\n", encoding="utf-8")
    return True

