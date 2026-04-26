from __future__ import annotations

import json
import logging
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping

import yaml
from langchain_core.messages import HumanMessage, SystemMessage

from .config import Settings, load_settings
from .llm import invoke_chat_model, make_chat_model

logger = logging.getLogger(__name__)

TEXT_EXTENSIONS = {
    ".md",
    ".mdx",
    ".txt",
    ".rst",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
}
MAX_SOURCE_CHARS = 45_000
MAX_TEMPLATE_CHARS = 12_000
MAX_CATALOG_CHARS = 18_000
DEFAULT_MAX_BOOTSTRAP_FILES = 24
# Small batches + high output token cap avoid truncated JSON (invalid mid-string) when
# the model returns {"files":[{"path":"...","content":"...very long markdown..."}]}
BATCH_GENERATION_SIZE = 2
MAX_PARALLEL_BATCHES = 3
BOOTSTRAP_PLAN_MAX_TOKENS = 6_000
BOOTSTRAP_GENERATION_MAX_TOKENS = 16_384
INDEX_PATH = "index.md"
MIN_RICH_BOOTSTRAP_FILES = 10
REQUIRED_BOOTSTRAP_PATHS = [
    "index.md",
    "map.md",
    "summaries/project_summary.md",
]


def _log_bootstrap(message: str) -> None:
    logger.info(message)
    print(f"[brain-agent] bootstrap: {message}", file=sys.stderr, flush=True)


@dataclass(frozen=True, slots=True)
class SourceDocument:
    """A raw source document used to generate the first working brain."""

    name: str
    text: str
    source_path: str | None = None


@dataclass(frozen=True, slots=True)
class BrainFilePlan:
    """A source-grounded Markdown file to generate for the working brain."""

    path: str
    title: str
    purpose: str
    template_path: str = ""
    evidence: tuple[str, ...] = ()
    links: tuple[str, ...] = ()


DocumentInput = str | Path | SourceDocument | Mapping[str, str]


def _read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _iter_document_paths(path: Path) -> Iterable[Path]:
    if path.is_file():
        if path.suffix.lower() in TEXT_EXTENSIONS:
            yield path
        return

    if not path.is_dir():
        return

    for child in sorted(path.rglob("*")):
        if child.is_file() and child.suffix.lower() in TEXT_EXTENSIONS:
            yield child


def _coerce_document(item: DocumentInput, index: int) -> list[SourceDocument]:
    if isinstance(item, SourceDocument):
        return [item]

    if isinstance(item, Path):
        return [
            SourceDocument(name=p.name, text=_read_text_file(p), source_path=str(p))
            for p in _iter_document_paths(item.expanduser())
        ]

    if isinstance(item, Mapping):
        text = item.get("text") or item.get("content") or item.get("body")
        if not text:
            raise ValueError("Document mappings must include text, content, or body")
        name = item.get("name") or item.get("title") or f"document-{index}"
        return [
            SourceDocument(
                name=name,
                text=text,
                source_path=item.get("source_path") or item.get("path"),
            )
        ]

    try:
        candidate = Path(item).expanduser()
        candidate_exists = candidate.exists()
    except (OSError, ValueError):
        candidate_exists = False

    if candidate_exists:
        return [
            SourceDocument(name=p.name, text=_read_text_file(p), source_path=str(p))
            for p in _iter_document_paths(candidate)
        ]

    return [SourceDocument(name=f"raw-text-{index}", text=item)]


def normalize_documents(documents: Iterable[DocumentInput]) -> list[SourceDocument]:
    """Accept raw text, files, directories, or document dicts and return text documents."""

    normalized: list[SourceDocument] = []
    for index, item in enumerate(documents, 1):
        normalized.extend(_coerce_document(item, index))

    normalized = [doc for doc in normalized if doc.text.strip()]
    if not normalized:
        raise ValueError("No readable source documents were provided")
    return normalized


def _source_digest(documents: list[SourceDocument], max_chars: int = MAX_SOURCE_CHARS) -> str:
    chunks: list[str] = []
    remaining = max_chars

    for doc in documents:
        if remaining <= 0:
            break
        header = f"\n\n--- SOURCE: {doc.name}"
        if doc.source_path:
            header += f" ({doc.source_path})"
        header += " ---\n"
        budget = max(0, remaining - len(header))
        excerpt = doc.text.strip()[:budget]
        chunks.append(header + excerpt)
        remaining -= len(header) + len(excerpt)

    if len(documents) > len(chunks) or any(len(doc.text.strip()) > MAX_SOURCE_CHARS for doc in documents):
        chunks.append("\n\n[Source context was truncated to fit the model prompt.]")

    return "".join(chunks).strip()


def _brain_markdown_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.md") if p.is_file())


def _prepare_output_tree(reference_dir: Path, output_dir: Path, overwrite: bool) -> None:
    if not reference_dir.is_dir():
        raise FileNotFoundError(f"Reference brain not found: {reference_dir}")

    if output_dir.exists():
        has_files = any(p.is_file() for p in output_dir.rglob("*"))
        if has_files and not overwrite:
            raise FileExistsError(
                f"Output brain already has files: {output_dir}. Pass overwrite=True to replace it."
            )
        if overwrite or not has_files:
            shutil.rmtree(output_dir)


def _message_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        if chunks:
            return "\n".join(chunks)
    return str(content)


def _parse_frontmatter(text: str) -> dict:
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return {}
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.DOTALL)
    if not match:
        return {}
    try:
        data = yaml.safe_load(match.group(1)) or {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _reference_catalog(reference_dir: Path) -> tuple[str, set[str]]:
    entries: list[str] = []
    valid_paths: set[str] = set()

    for template_file in _brain_markdown_files(reference_dir):
        relative_path = str(template_file.relative_to(reference_dir)).replace("\\", "/")
        valid_paths.add(relative_path)
        text = _read_text_file(template_file)
        frontmatter = _parse_frontmatter(text)
        raw_kw = frontmatter.get("keywords", [])
        keywords: list[str] = []
        if isinstance(raw_kw, list):
            keywords = [str(k).strip() for k in raw_kw if str(k).strip()][:12]
        # Never embed template body prose here — excerpts biased models toward the reference
        # product ("Brian") instead of the user's GitHub uploads and Google Workspace imports.
        entries.append(
            json.dumps(
                {
                    "path": relative_path,
                    "type": frontmatter.get("type", ""),
                    "importance": frontmatter.get("importance", ""),
                    "keywords": keywords,
                    "note": (
                        "Structural template only: reuse YAML keys, heading depth, and linking style. "
                        "Do not treat reference titles or any sample wording as facts about the user's project."
                    ),
                },
                ensure_ascii=True,
            )
        )

    catalog = "\n".join(entries)
    if len(catalog) > MAX_CATALOG_CHARS:
        catalog = catalog[:MAX_CATALOG_CHARS] + "\n[Catalog truncated.]"
    return catalog, valid_paths


def _strip_fenced_json(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _safe_brain_path(path: str) -> str | None:
    clean = path.replace("\\", "/").strip().strip("/")
    clean = re.sub(r"/+", "/", clean)
    if not clean or clean.startswith(".") or ".." in clean.split("/"):
        return None
    if clean.endswith("/"):
        return None
    if not clean.endswith(".md"):
        clean += ".md"
    if clean.startswith("/"):
        return None
    return clean


def _coerce_file_plan(item: object, valid_paths: set[str]) -> BrainFilePlan | None:
    if not isinstance(item, dict):
        return None
    raw_path = item.get("path")
    if not isinstance(raw_path, str):
        return None
    path = _safe_brain_path(raw_path)
    if not path:
        return None

    raw_template = item.get("template_path")
    template_path = raw_template.replace("\\", "/").strip() if isinstance(raw_template, str) else ""
    if template_path not in valid_paths:
        template_path = path if path in valid_paths else ""

    raw_evidence = item.get("evidence")
    evidence: tuple[str, ...]
    if isinstance(raw_evidence, list):
        evidence = tuple(str(value).strip() for value in raw_evidence if str(value).strip())[:5]
    else:
        evidence = ()

    raw_links = item.get("links")
    if isinstance(raw_links, list):
        links = tuple(str(value).strip() for value in raw_links if str(value).strip())[:8]
    else:
        links = ()

    title = item.get("title")
    purpose = item.get("purpose")
    return BrainFilePlan(
        path=path,
        title=str(title).strip() if isinstance(title, str) and title.strip() else Path(path).stem.replace("_", " ").replace("-", " ").title(),
        purpose=str(purpose).strip() if isinstance(purpose, str) and purpose.strip() else "Store source-grounded context for retrieval.",
        template_path=template_path,
        evidence=evidence,
        links=links,
    )


def _required_plan(path: str, valid_paths: set[str]) -> BrainFilePlan:
    titles = {
        "index.md": "Knowledge index",
        "map.md": "Topic link map",
        "summaries/project_summary.md": "Project summary",
    }
    purposes = {
        "index.md": "Entry point linking all generated notes about the user's project.",
        "map.md": "Mermaid or linked overview of the user's project topics and files.",
        "summaries/project_summary.md": "Shortest factual summary of the user's repos, uploads, and imports only.",
    }
    return BrainFilePlan(
        path=path,
        title=titles.get(path, Path(path).stem.replace("_", " ").replace("-", " ").title()),
        purpose=purposes.get(path, "Required documentation file grounded in user sources."),
        template_path=path if path in valid_paths else "",
        links=tuple(required for required in REQUIRED_BOOTSTRAP_PATHS if required != path),
    )


def _plan_brain_files(
    model: object,
    reference_dir: Path,
    source_digest: str,
    initial_prompt: str,
    max_files: int,
) -> list[BrainFilePlan]:
    catalog, valid_paths = _reference_catalog(reference_dir)
    if not valid_paths:
        raise ValueError(f"Reference brain has no Markdown templates: {reference_dir}")
    _log_bootstrap(
        "planning source-grounded brain files "
        f"templates={len(valid_paths)} catalog_chars={len(catalog)} "
        f"source_digest_chars={len(source_digest)} max_files={max_files}"
    )

    minimum_files = min(max_files, MIN_RICH_BOOTSTRAP_FILES)
    system = SystemMessage(
        "You plan interlinked Markdown files for an **enterprise company brain**: one **directory per org section** "
        "(`divisions/<slug>/` or `company/<slug>/`, pick one convention) when sources support it. Within each section, add "
        "**nested subfolders** (e.g. `divisions/eng/delivery/milestones.md`) when the material warrants depth—not only a flat set of files. "
        "Rich **cross-section** links so the org is navigable as Markdown + graph. "
        "Infer structure only from INITIAL PROMPT + SOURCE DOCUMENTS. "
        "Not the Brian documentation product or this repo's tooling unless sources discuss them. Reference catalog is layout-only. Return only JSON."
    )
    user = HumanMessage(
        f"""Plan the Markdown files for this working brain from the sources below.

## Org section layout (primary): `divisions/<slug>/` and/or `company/<slug>/`
- Always include `index.md`, `map.md`, and `summaries/project_summary.md`.
- **Pick one top-level convention** for department/org units: **`divisions/<section-slug>/`** (matches the in-app “division” graph) **or** the legacy-style **`company/<section-slug>/`**. Do not mix them for the *same* org unit; prefer **`divisions/<slug>/`** for new plans unless the sources already use `company/`.
- **Every active org section** MUST include *either* `divisions/<slug>/overview.md` *or* `company/<slug>/overview.md` as the hub. Slug: lowercase, hyphenated (e.g. `engineering`, `product`, `marketing`, `people`).
- **Multi-layer (when context permits):** add **nested subfolders** under that section, not just flat files. Examples (only with evidence):
  - `divisions/<slug>/delivery/milestones.md`, `divisions/<slug>/delivery/dependencies.md`
  - `divisions/<slug>/people/team.md`, `divisions/<slug>/risks/tracker.md` (or flat `.../risks.md` if shallow)
  - `company/<slug>/roadmap/now-next-later.md` (same idea under `company/`)
- Aim for **at least 3 files per org section** when sources are rich (hub overview + 2+ supporting pages). Weak sources → one hub + `open_questions.md` (or `notes/capture.md`) only.
- **Peer links:** The section hub’s `links` must include the spine plus **at least two** other planned paths: peer `divisions/*/overview.md` or `company/*/overview.md`, and/or `projects/*` or `governance/*` when dependencies exist. Show how sections hand off work.
- **`map.md`:** `links` to **every** section hub you planned (`divisions/*/overview.md` and/or `company/*/overview.md`) and to `projects/*/overview.md` when present.
- **`index.md`:** a **## Org sections** (or **## Company sections**) block listing every section hub with one line each, plus `map.md`, summary, and `projects/` when present.
- **GitHub / code:** `projects/<repo-slug>/` for repo depth; link from the relevant **section hub** (e.g. `divisions/engineering/overview.md` ↔ `projects/<repo>/overview.md`).
- If imports are **only one codebase**, a single **section** (e.g. `divisions/engineering/`) plus `projects/<slug>/` is enough—do **not** fabricate empty trees.
- Optional cross-org topics: `divisions/cross-cutting/` or `company/cross-cutting/` only when sources support it.
- Legacy `context/<slug>/` is discouraged; prefer `divisions/<slug>/` or `company/<slug>/`.
- Optional spine: `meta/using_this_brain.md`, `governance/agent_guardrails.md` (at most one each).
- `summaries/project_summary.md`: executive view of the **whole company / initiative** with bullets for each section and **explicit markdown links** to every section overview—evidence-backed only.

## Grounding
- Every planned file: 1–3 `evidence` bullets from SOURCE DOCUMENTS or INITIAL PROMPT.
- Weak evidence → short overview + open questions; no invented numbers.
- Do NOT name or market the Brian documentation product, this tool, or irrelevant demo stacks unless sources say so.

## Graph / linking
- Each file plan's `links`: **2–6** paths from this plan. Prefer **cross-section** links (Product ↔ Engineering ↔ Finance) grounded in sources.
- `template_path` only when a reference file helps structure.

## Titles (YAML `title` in generated frontmatter)
- Every planned `title` must be **distinct** across the brain when sources allow—**do not** give every `company/<slug>/overview.md` (or `divisions/<slug>/overview.md`) the same generic string like `"Overview"`. Use **section-specific** names (e.g. `"Engineering org overview"`, `"Finance org overview"`, `"Product area overview"`) so navigation and graph search stay unambiguous.

## Output shape
- `"context_domains"`: array of `{{"slug": "engineering", "rationale": "…"}}` for each org-section hub; slug is the **folder name** under `divisions/<slug>/` or `company/<slug>/` (one entry per active section).
- `"files"`, `"rationale"` as before.
- Example (abbreviated, divisions + nested file):
  {{"context_domains": [{{"slug": "engineering", "rationale": "Engineering from repo + product docs"}}], "files": [{{"path": "index.md", "title": "Brain index", "purpose": "Entry; lists org sections", "template_path": "index.md", "evidence": ["…"], "links": ["summaries/project_summary.md", "map.md", "divisions/engineering/overview.md"]}}, {{"path": "divisions/engineering/delivery/milestones.md", "title": "Milestones", "purpose": "Delivery schedule grounded in sources", "template_path": "", "evidence": ["…"], "links": ["divisions/engineering/overview.md", "map.md"]}}], "rationale": "…"}}

## Budget
- Plan at least {minimum_files} files and at most {max_files} files total.

INITIAL PROMPT:
```text
{initial_prompt.strip() or "(none provided)"}
```

REFERENCE TEMPLATE CATALOG:
```jsonl
{catalog}
```

SOURCE DOCUMENTS:
```text
{source_digest}
```
"""
    )
    response = invoke_chat_model(  # type: ignore[arg-type]
        model,
        [system, user],
        label="bootstrap source-grounded file plan",
    )
    raw = _strip_fenced_json(_message_text(getattr(response, "content", response)))
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model did not return valid brain-plan JSON: {raw[:500]}") from exc

    files = parsed.get("files") if isinstance(parsed, dict) else None
    if not isinstance(files, list):
        raise ValueError("Brain-plan JSON must include a files list")

    ctx_dom = parsed.get("context_domains") if isinstance(parsed, dict) else None
    if isinstance(ctx_dom, list) and ctx_dom:
        _log_bootstrap(f"context_domains={ctx_dom!r}")

    plans: list[BrainFilePlan] = []
    for required_path in REQUIRED_BOOTSTRAP_PATHS:
        if len(plans) >= max_files:
            break
        plans.append(_required_plan(required_path, valid_paths))

    for item in files:
        if len(plans) >= max_files:
            break
        plan = _coerce_file_plan(item, valid_paths)
        if not plan:
            continue
        if plan.path in {existing.path for existing in plans}:
            continue
        plans.append(plan)

    if len(plans) < minimum_files:
        fallback_paths = [
            "company/cross-cutting/key_facts.md",
            "company/cross-cutting/open_questions.md",
            "divisions/cross-cutting/key_context.md",
            "divisions/cross-cutting/open_questions.md",
        ]
        for fallback_path in fallback_paths:
            if len(plans) >= min(max_files, minimum_files):
                break
            if fallback_path in {existing.path for existing in plans}:
                continue
            plans.append(
                BrainFilePlan(
                    path=fallback_path,
                    title=Path(fallback_path).stem.replace("_", " ").replace("-", " ").title(),
                    purpose="Source-grounded supporting context created because the uploaded material needs a richer retrieval graph.",
                    template_path=fallback_path if fallback_path in valid_paths else "",
                    links=("index.md", "summaries/project_summary.md"),
                )
            )

    _log_bootstrap(f"planned files={[plan.path for plan in plans]}")
    return plans[:max_files]


def _cousin_company_section_paths(relative_path: str, selected_paths: list[str], *, max_cousins: int = 5) -> list[str]:
    """Other `company/<slug>/` hubs (prefer overview.md) for cross-section graph edges."""
    parts = relative_path.split("/")
    if len(parts) < 2 or parts[0] != "company":
        return []
    my_slug = parts[1]
    slugs = sorted(
        {
            p.split("/")[1]
            for p in selected_paths
            if p.startswith("company/") and len(p.split("/")) > 1 and p.split("/")[1] != "cross-cutting"
        }
    )
    out: list[str] = []
    for slug in slugs:
        if slug == my_slug:
            continue
        ovs = sorted(
            p
            for p in selected_paths
            if p.startswith(f"company/{slug}/") and p.endswith("overview.md")
        )
        if not ovs:
            ovs = sorted(p for p in selected_paths if p.startswith(f"company/{slug}/"))
        if ovs:
            out.append(ovs[0])
        if len(out) >= max_cousins:
            break
    return out


def _cousin_division_section_paths(relative_path: str, selected_paths: list[str], *, max_cousins: int = 5) -> list[str]:
    """Other `divisions/<slug>/` hubs (prefer overview.md) for cross-division graph edges."""
    parts = relative_path.split("/")
    if len(parts) < 2 or parts[0] != "divisions":
        return []
    my_slug = parts[1]
    slugs = sorted(
        {
            p.split("/")[1]
            for p in selected_paths
            if p.startswith("divisions/") and len(p.split("/")) > 1 and p.split("/")[1] != "cross-cutting"
        }
    )
    out: list[str] = []
    for slug in slugs:
        if slug == my_slug:
            continue
        ovs = sorted(
            p
            for p in selected_paths
            if p.startswith(f"divisions/{slug}/") and p.endswith("overview.md")
        )
        if not ovs:
            ovs = sorted(p for p in selected_paths if p.startswith(f"divisions/{slug}/"))
        if ovs:
            out.append(ovs[0])
        if len(out) >= max_cousins:
            break
    return out


def _cousin_project_paths(relative_path: str, selected_paths: list[str], *, max_cousins: int = 3) -> list[str]:
    """Other `projects/<slug>/` hubs (prefer overview.md) for cross-project graph edges."""
    parts = relative_path.split("/")
    if len(parts) < 2 or parts[0] != "projects":
        return []
    my_slug = parts[1]
    slugs = sorted(
        {
            p.split("/")[1]
            for p in selected_paths
            if p.startswith("projects/") and len(p.split("/")) > 1
        }
    )
    out: list[str] = []
    for slug in slugs:
        if slug == my_slug:
            continue
        ovs = sorted(
            p
            for p in selected_paths
            if p.startswith(f"projects/{slug}/") and p.endswith("overview.md")
        )
        if not ovs:
            ovs = sorted(p for p in selected_paths if p.startswith(f"projects/{slug}/"))
        if ovs:
            out.append(ovs[0])
        if len(out) >= max_cousins:
            break
    return out


def _ensure_index_links(content: str, selected_paths: list[str]) -> str:
    linked_paths = [path for path in selected_paths if path != INDEX_PATH]
    missing = [path for path in linked_paths if path not in content]
    if not missing:
        return content

    lines = [content.rstrip(), "", "## Generated documentation files", ""]
    lines.extend(f"- [{path}]({path})" for path in missing)
    return "\n".join(lines) + "\n"


def _ensure_frontmatter_links(content: str, relative_path: str, selected_paths: list[str], plan_links: tuple[str, ...]) -> str:
    valid_links = [
        link
        for link in plan_links
        if link in selected_paths and link != relative_path
    ]
    if not valid_links:
        valid_links = [
            path
            for path in selected_paths
            if path != relative_path and (path == INDEX_PATH or path.startswith(relative_path.split("/")[0] + "/"))
        ][:5]

    hub_extra = [
        p
        for p in REQUIRED_BOOTSTRAP_PATHS
        if p in selected_paths and p != relative_path
    ]
    cousin_extra = [
        *_cousin_project_paths(relative_path, selected_paths),
        *_cousin_company_section_paths(relative_path, selected_paths),
        *_cousin_division_section_paths(relative_path, selected_paths),
    ]
    merged = list(dict.fromkeys([*valid_links, *hub_extra, *cousin_extra]))[:10]
    valid_links = merged

    if not valid_links:
        return content

    if not content.startswith("---\n"):
        return content
    end = content.find("\n---", 4)
    if end == -1:
        return content
    frontmatter = content[4:end]
    body = content[end:]
    link_lines = "links:\n" + "\n".join(f"  - {link}" for link in valid_links)
    if re.search(r"(?m)^links:\s*(?:\[[^\n]*\])?\s*$", frontmatter):
        frontmatter = re.sub(
            r"(?ms)^links:\s*(?:\[[^\n]*\])?\s*(?:\n\s+-\s+[^\n]+)*",
            link_lines,
            frontmatter,
            count=1,
        )
    else:
        frontmatter = frontmatter.rstrip() + "\n" + link_lines
    return "---\n" + frontmatter.strip() + body


def _strip_markdown_fence(content: str) -> str:
    text = content.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _batched(items: list[BrainFilePlan], size: int) -> Iterable[list[BrainFilePlan]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _generate_file_batch(
    model: object,
    reference_dir: Path,
    batch_plans: list[BrainFilePlan],
    source_digest: str,
    initial_prompt: str,
    selected_paths: list[str],
) -> dict[str, str]:
    templates = []
    batch_paths = [plan.path for plan in batch_plans]
    for plan in batch_plans:
        template_file = reference_dir / plan.template_path if plan.template_path else None
        template = _read_text_file(template_file) if template_file and template_file.is_file() else ""
        templates.append(
            {
                "path": plan.path,
                "title": plan.title,
                "purpose": plan.purpose,
                "source_evidence": list(plan.evidence),
                "planned_links": list(plan.links),
                "template_path": plan.template_path,
                "template": template[:MAX_TEMPLATE_CHARS],
            }
        )
    _log_bootstrap(
        f"generating batch size={len(batch_paths)} files={batch_paths} "
        f"template_chars={sum(len(item['template']) for item in templates)}"
    )

    system = SystemMessage(
        "You write Markdown for a **company brain**: directories mirror **org sections**; files **link across sections** "
        "so humans and AI agents navigate the business like a small intranet. "
        "Each doc states **audience**, **decisions**, and **hand-offs** to other departments. "
        "Facts only from SOURCE DOCUMENTS + INITIAL PROMPT. Templates = YAML/heading hints only. Return only JSON."
    )
    user = HumanMessage(
        f"""Create these Markdown files: {", ".join(batch_paths)}.

For **`company/<section>/`** files: after frontmatter, add **## Audience** (roles). Add **## How this section connects** (or **## Peer sections**) with **bullet list of Markdown links** to other `company/*/overview.md` and relevant `projects/*` files when those paths exist in the selected set—this is the main “inner company” navigation.
For **`company/cross-cutting/**`: org-wide themes that span departments.
For **governance/** or **meta/**: guardrails and what agents must verify with humans.

Use each file plan's title, purpose, and `source_evidence`.
Use templates only for frontmatter style, heading style, and organization hints.
Never copy prose, product names, or stack claims from a template file body.
Never mention the Brian documentation product, this tool, or stack trivia unless those facts appear in SOURCE DOCUMENTS or INITIAL PROMPT.
Every factual statement must be supported by SOURCE DOCUMENTS or INITIAL PROMPT.
If under-specified, write a concise source-grounded note plus `## Open questions`—no invented metrics.

Preserve useful YAML keys when possible:
id, type, title, status, importance, updated, links, keywords.
Use `{date.today().isoformat()}` only if the template has an updated field.
Keep links limited to these selected files: {", ".join(selected_paths) or "(none)"}
Use each file plan's `planned_links` as the default frontmatter `links`, plus clearly related selected paths.
Prefer exact paths such as `company/engineering/overview.md` and `projects/my-repo/overview.md`.

If creating `index.md`: entry point with **## Company sections** — for each `company/*/overview.md` in the selected set, a short bullet with a Markdown link and one-line purpose; also link `map.md`, `summaries/project_summary.md`, and `projects/*/overview.md` hubs.
If creating `map.md`: a **Mermaid** diagram (flowchart or graph) with **one subgraph per `company/<slug>/` section** that has files in the plan, and edges showing dependencies between sections and key `projects/*` hubs (labels from sources). If Mermaid is too large, use a compact diagram plus a **## Link index** table listing section pairs and relationship from evidence.
If creating `summaries/project_summary.md`: executive snapshot; **## Company sections at a glance** with links to every section overview; **what agents must know first**; evidence-backed only.

Include `## Source Evidence` in every non-index file with bullets from the file plan and/or SOURCE DOCUMENTS.

Return ONE complete JSON object (no markdown fences). In each `content` string use JSON escapes for newlines (\\n) only—no raw line breaks inside the string.
The JSON must be **complete and valid** so `json.loads` succeeds: if you are near the output limit, shorten sections rather than stopping mid-string.

Return JSON exactly like:
{{"files": [{{"path": "index.md", "content": "---\\n...complete markdown...\\n"}}]}}

INITIAL PROMPT:
```text
{initial_prompt.strip() or "(none provided)"}
```

FILE PLANS AND OPTIONAL TEMPLATES:
```json
{json.dumps(templates, ensure_ascii=True)}
```

SOURCE DOCUMENTS:
```text
{source_digest}
```
"""
    )
    response = invoke_chat_model(  # type: ignore[arg-type]
        model,
        [system, user],
        label=f"generate batch {', '.join(batch_paths)}",
    )
    raw = _strip_fenced_json(_message_text(getattr(response, "content", response)))
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model did not return valid batch-generation JSON: {raw[:500]}") from exc

    files = parsed.get("files") if isinstance(parsed, dict) else None
    if not isinstance(files, list):
        raise ValueError("Batch-generation JSON must include a files list")

    generated: dict[str, str] = {}
    expected = set(batch_paths)
    for item in files:
        if not isinstance(item, dict):
            continue
        path = item.get("path")
        content = item.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            continue
        relative_path = path.replace("\\", "/").strip()
        if relative_path not in expected:
            continue
        clean_content = _strip_markdown_fence(content)
        if relative_path == INDEX_PATH:
            clean_content = _ensure_index_links(clean_content, selected_paths).rstrip()
        plan = next((candidate for candidate in batch_plans if candidate.path == relative_path), None)
        if plan:
            clean_content = _ensure_frontmatter_links(clean_content, relative_path, selected_paths, plan.links).rstrip()
        generated[relative_path] = clean_content.rstrip() + "\n"

    missing = [path for path in batch_paths if path not in generated]
    if missing:
        raise ValueError(f"Batch-generation JSON omitted files: {', '.join(missing)}")
    _log_bootstrap(f"generated batch files={sorted(generated)}")
    return generated


def _generate_file_batch_resilient(
    model: object,
    reference_dir: Path,
    batch_plans: list[BrainFilePlan],
    source_digest: str,
    initial_prompt: str,
    selected_paths: list[str],
) -> dict[str, str]:
    """Generate a batch of files; on truncated/invalid JSON, split the batch and retry."""
    try:
        return _generate_file_batch(
            model,
            reference_dir,
            batch_plans,
            source_digest,
            initial_prompt,
            selected_paths,
        )
    except ValueError as exc:
        msg = str(exc)
        retryable = "valid batch-generation JSON" in msg or "omitted files" in msg
        if not retryable or len(batch_plans) <= 1:
            raise
        mid = max(1, len(batch_plans) // 2)
        first, second = batch_plans[:mid], batch_plans[mid:]
        _log_bootstrap(
            f"batch generation retry: splitting {len(batch_plans)} files into "
            f"{len(first)} + {len(second)} (was: {msg[:120]}…)"
        )
        merged: dict[str, str] = {}
        merged.update(
            _generate_file_batch_resilient(
                model, reference_dir, first, source_digest, initial_prompt, selected_paths
            )
        )
        merged.update(
            _generate_file_batch_resilient(
                model, reference_dir, second, source_digest, initial_prompt, selected_paths
            )
        )
        return merged


def create_brain_from_documents_streaming(
    documents: Iterable[DocumentInput],
    *,
    output_dir: str | Path | None = None,
    reference_dir: str | Path | None = None,
    settings: Settings | None = None,
    overwrite: bool = False,
    initial_prompt: str = "",
    max_files: int = DEFAULT_MAX_BOOTSTRAP_FILES,
) -> Iterator[dict[str, Any]]:
    """
    Create a source-grounded working brain and yield writer progress events.

    The reference brain directory is schema/style guidance only. Output Markdown must
    document the user's supplied sources and must not inherit sample product facts.
    """

    s = settings or load_settings(validate=True)
    if max_files < 1:
        raise ValueError("max_files must be at least 1")
    ref = Path(reference_dir or s.brian_reference_dir).expanduser().resolve()
    out = Path(output_dir or s.brain_dir).expanduser().resolve()
    _log_bootstrap(f"starting create_brain_from_documents max_files={max_files} overwrite={overwrite}")
    source_docs = normalize_documents(documents)
    source_digest = _source_digest(source_docs)
    source_chars = sum(len(doc.text) for doc in source_docs)
    _log_bootstrap(
        f"normalized documents count={len(source_docs)} source_chars={source_chars} "
        f"digest_chars={len(source_digest)} names={[doc.name for doc in source_docs]}"
    )

    _prepare_output_tree(ref, out, overwrite=overwrite)
    _log_bootstrap(f"prepared output tree reference={ref} output={out}")

    plan_model = make_chat_model(s, max_tokens=BOOTSTRAP_PLAN_MAX_TOKENS)
    write_model = make_chat_model(s, max_tokens=BOOTSTRAP_GENERATION_MAX_TOKENS)
    file_plans = _plan_brain_files(plan_model, ref, source_digest, initial_prompt, max_files)
    selected_paths = [plan.path for plan in file_plans]
    written: dict[str, str] = {}

    for plan in file_plans:
        output_file = out / plan.path
        output_file.parent.mkdir(parents=True, exist_ok=True)
        yield {
            "type": "file_planned",
            "path": plan.path,
            "title": plan.title,
            "purpose": plan.purpose,
            "links": list(plan.links) or [path for path in selected_paths if path != plan.path][:5],
        }

    batches = list(_batched(file_plans, BATCH_GENERATION_SIZE))
    _log_bootstrap(f"generating {len(file_plans)} planned files in {len(batches)} batch(es)")
    for batch_plans in batches:
        for plan in batch_plans:
            yield {
                "type": "file_writing",
                "path": plan.path,
                "title": plan.title,
            }

    def generate_batch(batch_index: int, batch_plans: list[BrainFilePlan]) -> tuple[int, dict[str, str]]:
        _log_bootstrap(f"starting batch {batch_index}/{len(batches)}")
        return (
            batch_index,
            _generate_file_batch_resilient(
                write_model,
                ref,
                batch_plans,
                source_digest,
                initial_prompt,
                selected_paths,
            ),
        )

    max_workers = min(MAX_PARALLEL_BATCHES, max(1, len(batches)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(generate_batch, index, batch_plans)
            for index, batch_plans in enumerate(batches, 1)
        ]
        for future in as_completed(futures):
            _, batch_content = future.result()
            for relative_path, content in batch_content.items():
                output_file = out / relative_path
                output_file.parent.mkdir(parents=True, exist_ok=True)
                output_file.write_text(content, encoding="utf-8")
                written[relative_path] = content
                _log_bootstrap(f"wrote file={relative_path} chars={len(content)}")
                yield {
                    "type": "file_created",
                    "path": relative_path,
                    "title": next((plan.title for plan in file_plans if plan.path == relative_path), ""),
                    "content": content,
                }

    _log_bootstrap(f"finished create_brain_from_documents written={sorted(written)}")
    yield {"type": "done", "written": written}


def create_brain_from_documents(
    documents: Iterable[DocumentInput],
    *,
    output_dir: str | Path | None = None,
    reference_dir: str | Path | None = None,
    settings: Settings | None = None,
    overwrite: bool = False,
    initial_prompt: str = "",
    max_files: int = DEFAULT_MAX_BOOTSTRAP_FILES,
) -> dict[str, str]:
    """Create a source-grounded working brain from raw text/documents."""
    written: dict[str, str] = {}
    for event in create_brain_from_documents_streaming(
        documents,
        output_dir=output_dir,
        reference_dir=reference_dir,
        settings=settings,
        overwrite=overwrite,
        initial_prompt=initial_prompt,
        max_files=max_files,
    ):
        if event.get("type") == "done":
            value = event.get("written")
            if isinstance(value, dict):
                written = {str(path): str(content) for path, content in value.items()}
    return written
