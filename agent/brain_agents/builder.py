from __future__ import annotations

import json
import logging
import re
import shutil
import sys
from datetime import date
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping

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
DEFAULT_MAX_BOOTSTRAP_FILES = 3
BATCH_GENERATION_SIZE = 5
INDEX_PATH = "index.md"


def _log_bootstrap(message: str) -> None:
    logger.info(message)
    print(f"[brain-agent] bootstrap: {message}", file=sys.stderr, flush=True)


@dataclass(frozen=True, slots=True)
class SourceDocument:
    """A raw source document used to generate the first working brain."""

    name: str
    text: str
    source_path: str | None = None


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
        body = re.sub(r"^---\r?\n.*?\r?\n---\r?\n?", "", text, flags=re.DOTALL).strip()
        excerpt = " ".join(body.split())[:500]
        entries.append(
            json.dumps(
                {
                    "path": relative_path,
                    "title": frontmatter.get("title", ""),
                    "type": frontmatter.get("type", ""),
                    "importance": frontmatter.get("importance", ""),
                    "keywords": frontmatter.get("keywords", []),
                    "purpose_hint": excerpt,
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


def _select_relevant_files(
    model: object,
    reference_dir: Path,
    source_digest: str,
    initial_prompt: str,
    max_files: int,
) -> list[str]:
    catalog, valid_paths = _reference_catalog(reference_dir)
    if not valid_paths:
        raise ValueError(f"Reference brain has no Markdown templates: {reference_dir}")
    _log_bootstrap(
        "selecting relevant files "
        f"templates={len(valid_paths)} catalog_chars={len(catalog)} "
        f"source_digest_chars={len(source_digest)} max_files={max_files}"
    )

    system = SystemMessage(
        "You select the smallest useful set of Markdown project-brain files to create "
        "from source documents. The index.md file is mandatory. Return only JSON."
    )
    user = HumanMessage(
        f"""Choose which reference templates are necessary for the initial working brain.

Rules:
- Always include `index.md`; it is the required entry point for every working brain.
- Select only files whose purpose is directly supported by the initial prompt or source documents.
- Do not include files just because they exist in the reference tree.
- Prefer one concise summary file over many specialized files when the source material is thin.
- Use the remaining file budget for documents that `index.md` should link to.
- Select at most {max_files} file(s).
- Return JSON exactly like: {{"files": ["path/from/catalog.md"], "rationale": "short reason"}}

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
        label="bootstrap file selection",
    )
    raw = _strip_fenced_json(_message_text(getattr(response, "content", response)))
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model did not return valid file-selection JSON: {raw[:500]}") from exc

    files = parsed.get("files") if isinstance(parsed, dict) else None
    if not isinstance(files, list):
        raise ValueError("File-selection JSON must include a files list")

    selected: list[str] = []
    for item in files:
        if not isinstance(item, str):
            continue
        relative_path = item.replace("\\", "/").strip()
        if relative_path in valid_paths and relative_path not in selected:
            selected.append(relative_path)
        if len(selected) >= max_files:
            break

    if INDEX_PATH not in valid_paths:
        selected_paths = selected[:max_files]
        _log_bootstrap(f"selected files={selected_paths}")
        return selected_paths

    linked_files = [path for path in selected if path != INDEX_PATH]
    selected_paths = [INDEX_PATH, *linked_files[: max_files - 1]]
    _log_bootstrap(f"selected files={selected_paths}")
    return selected_paths


def _ensure_index_links(content: str, selected_paths: list[str]) -> str:
    linked_paths = [path for path in selected_paths if path != INDEX_PATH]
    missing = [path for path in linked_paths if path not in content]
    if not missing:
        return content

    lines = [content.rstrip(), "", "## Generated Brain Files", ""]
    lines.extend(f"- [{path}]({path})" for path in missing)
    return "\n".join(lines) + "\n"


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


def _batched(items: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _generate_file_batch(
    model: object,
    reference_dir: Path,
    batch_paths: list[str],
    source_digest: str,
    initial_prompt: str,
    selected_paths: list[str],
) -> dict[str, str]:
    templates = []
    for relative_path in batch_paths:
        template_file = reference_dir / relative_path
        template = _read_text_file(template_file) if template_file.is_file() else ""
        templates.append(
            {
                "path": relative_path,
                "template": template[:MAX_TEMPLATE_CHARS],
            }
        )
    _log_bootstrap(
        f"generating batch size={len(batch_paths)} files={batch_paths} "
        f"template_chars={sum(len(item['template']) for item in templates)}"
    )

    system = SystemMessage(
        "You create Markdown project-brain files from raw source documents. "
        "Return only valid JSON with generated file contents."
    )
    user = HumanMessage(
        f"""Create these Markdown files for a new working brain: {", ".join(batch_paths)}.

Use each template for that file's structure, frontmatter style, heading style, and level of detail.
Replace Brian/sample-specific facts with facts supported by the source documents.
Keep the same purpose as each template file. Preserve the same YAML keys when possible:
id, type, title, status, importance, updated, links, keywords.
Use `{date.today().isoformat()}` only if the template has an updated field.
Do not invent unsupported implementation details. If source material is thin, write a concise starter note and list open questions.
Keep links limited to these selected files, and omit links to uncreated files: {", ".join(selected_paths) or "(none)"}
If creating `index.md`, treat it as the mandatory entry point and include Markdown links to every other selected file.

Return JSON exactly like:
{{"files": [{{"path": "index.md", "content": "---\\n...complete markdown...\\n"}}]}}

INITIAL PROMPT:
```text
{initial_prompt.strip() or "(none provided)"}
```

TEMPLATES:
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
        generated[relative_path] = clean_content.rstrip() + "\n"

    missing = [path for path in batch_paths if path not in generated]
    if missing:
        raise ValueError(f"Batch-generation JSON omitted files: {', '.join(missing)}")
    _log_bootstrap(f"generated batch files={sorted(generated)}")
    return generated


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
    """
    Create a minimal working brain from raw text/documents using `brian/` as schema guidance.

    A model first selects the smallest relevant subset of reference templates, then only
    those files are created and filled with content distilled from the provided documents.
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

    model = make_chat_model(s)
    selected_paths = _select_relevant_files(model, ref, source_digest, initial_prompt, max_files)
    written: dict[str, str] = {}
    batches = list(_batched(selected_paths, BATCH_GENERATION_SIZE))
    _log_bootstrap(f"generating {len(selected_paths)} selected files in {len(batches)} batch(es)")
    for index, batch_paths in enumerate(batches, 1):
        _log_bootstrap(f"starting batch {index}/{len(batches)}")
        batch_content = _generate_file_batch(
            model,
            ref,
            batch_paths,
            source_digest,
            initial_prompt,
            selected_paths,
        )
        for relative_path, content in batch_content.items():
            output_file = out / relative_path
            output_file.parent.mkdir(parents=True, exist_ok=True)
            output_file.write_text(content, encoding="utf-8")
            written[relative_path] = content
            _log_bootstrap(f"wrote file={relative_path} chars={len(content)}")

    _log_bootstrap(f"finished create_brain_from_documents written={sorted(written)}")
    return written
