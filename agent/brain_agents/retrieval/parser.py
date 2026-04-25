"""Markdown -> Section parser.

Splits a Markdown file into one ``Section`` per H2 (``##``) heading. Content
that appears between the YAML frontmatter and the first H2 is captured as a
synthetic ``#_intro`` section so that file-level prose (and any H1 title) is
still retrievable.

Section IDs are deterministic and human-readable: ``<relative_path>#<slug>``.
That same ID is what the update module uses to address a section.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
_H2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


@dataclass(slots=True)
class Section:
    """One indexable chunk of a Markdown file."""

    file_path: str
    section_id: str
    heading: str
    content: str
    frontmatter: dict = field(default_factory=dict)
    source_kind: str | None = None

    @property
    def text_for_embedding(self) -> str:
        """Concatenate heading + content for embeddings/rerankers.

        Including the heading boosts recall on short queries that match the
        title (e.g. "constraints", "open questions").
        """
        if self.heading and self.heading != "Intro":
            return f"{self.heading}\n\n{self.content}".strip()
        return self.content.strip()


def _slugify(text: str) -> str:
    s = _SLUG_STRIP.sub("-", text.lower()).strip("-")
    return s or "section"


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return ``(frontmatter_dict, body_after_frontmatter)``.

    Returns ``({}, text)`` when no frontmatter block is present or when YAML
    parsing fails — we never want a malformed header to break indexing.
    """
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        return {}, text
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except Exception:
        fm = {}
    if not isinstance(fm, dict):
        fm = {}
    return fm, text[m.end():]


def _extract_source_kind(frontmatter: dict) -> str | None:
    src = frontmatter.get("source")
    if isinstance(src, dict):
        kind = src.get("kind")
        if isinstance(kind, str):
            return kind
    if isinstance(src, str):
        return src
    kind = frontmatter.get("source_kind")
    if isinstance(kind, str):
        return kind
    return None


def parse_markdown(path: Path, brain_root: Path) -> list[Section]:
    """Parse one Markdown file into a list of ``Section`` objects.

    Behaviour:
      * The first chunk (text before the first H2, after frontmatter) is the
        ``#_intro`` section with heading ``"Intro"``. This always exists, even
        if empty, so every file contributes at least one searchable unit.
      * Each subsequent ``## Heading`` starts a new section. The heading text
        becomes the slug. Duplicate slugs within a file are disambiguated with
        a numeric suffix.
      * The H2 line itself is stripped from the section's ``content``; the
        heading lives on the dataclass instead.
    """
    raw = path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body = _parse_frontmatter(raw)
    source_kind = _extract_source_kind(frontmatter)

    rel_path = path.resolve().relative_to(brain_root.resolve()).as_posix()

    matches = list(_H2_RE.finditer(body))
    sections: list[Section] = []
    seen_slugs: dict[str, int] = {}

    def make_id(slug: str) -> str:
        n = seen_slugs.get(slug, 0)
        seen_slugs[slug] = n + 1
        suffix = "" if n == 0 else f"-{n + 1}"
        return f"{rel_path}#{slug}{suffix}"

    intro_end = matches[0].start() if matches else len(body)
    intro_content = body[:intro_end].strip()
    sections.append(
        Section(
            file_path=rel_path,
            section_id=f"{rel_path}#_intro",
            heading="Intro",
            content=intro_content,
            frontmatter=frontmatter,
            source_kind=source_kind,
        )
    )
    seen_slugs["_intro"] = 1

    for i, m in enumerate(matches):
        heading = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        content = body[start:end].strip()
        slug = _slugify(heading)
        sections.append(
            Section(
                file_path=rel_path,
                section_id=make_id(slug),
                heading=heading,
                content=content,
                frontmatter=frontmatter,
                source_kind=source_kind,
            )
        )

    return sections
