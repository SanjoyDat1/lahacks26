from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, List

import yaml
from langchain_core.tools import tool

from .retrieval import RetrievalHit
from .services.retrieval_service import retrieval_service
if TYPE_CHECKING:
    from .retrieval import Retriever


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


def _get_retriever(brain_root: Path) -> Retriever:
    return retrieval_service.get(brain_root)


def _format_hits(hits: list[RetrievalHit]) -> str:
    if not hits:
        return "(no relevant sections found)"
    out: list[str] = []
    total_tokens = 0
    for h in hits:
        total_tokens += h.tokens
        head = f"## {h.heading}" if h.heading and h.heading != "Intro" else "## (file intro)"
        out.append(
            f"### {h.file_path}  —  `{h.section_id}`\n"
            f"_rerank={h.rerank_score:.3f}  dense={h.dense_score:.3f}  "
            f"tokens={h.tokens}  source={h.source_kind or 'n/a'}_\n\n"
            f"{head}\n\n{h.content.strip()}"
        )
    out.append(f"\n_(total tokens ≈ {total_tokens})_")
    return "\n\n---\n\n".join(out)


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
    def upsert_working_file(relative_path: str, new_content: str) -> str:
        """
        Create or replace a Markdown file in the working brain.

        Use this when updating the knowledge base requires a new note or a full
        rewrite of an existing note. Paths are relative to the working brain.
        """
        p = _safe_join(wk, relative_path)
        if p.suffix.lower() != ".md":
            return "Refuse: only .md files are allowed"
        p.parent.mkdir(parents=True, exist_ok=True)
        existed = p.exists()
        p.write_text(new_content, encoding="utf-8")
        retrieval_service.invalidate(wk)
        action = "Updated" if existed else "Created"
        return f"{action} {relative_path} ({len(new_content)} chars)."

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
        retrieval_service.invalidate(wk)
        return f"Wrote {relative_path} ({len(new_content)} chars)."

    @tool
    def semantic_search(query: str, top_k: int = 5) -> str:
        """
        Two-stage semantic search across the working brain.

        Uses a BGE dense encoder + cross-encoder reranker (with offline BM25 +
        keyword fallback per ADR-0002), authority weighting from frontmatter
        `source.kind`, and a default token budget appropriate for short
        previews. Returns a Markdown bundle of the top sections with file
        paths, section IDs, and scores. Prefer this over `search_working_brain`
        for natural-language questions.
        """
        try:
            r = _get_retriever(wk if wk.is_dir() else ref)
        except FileNotFoundError as e:
            return f"Brain not initialized: {e}"
        hits = r.query(query, top_k=top_k, token_budget=2000)
        return _format_hits(hits)

    @tool
    def get_brief(task: str, token_budget: int = 2000) -> str:
        """
        Build a token-budgeted briefing bundle for a task.

        Same retrieval pipeline as `semantic_search`, but explicitly packs the
        result to the requested token budget (default 2000 cl100k tokens).
        Always tries to include `context/constraints.md` and
        `context/open_questions.md` when they're in the shortlist, even if
        that pushes ≤20% over budget. Use this when feeding the brain into
        another LLM call where context-window pressure matters.
        """
        try:
            r = _get_retriever(wk if wk.is_dir() else ref)
        except FileNotFoundError as e:
            return f"Brain not initialized: {e}"
        hits = r.query(task, top_k=8, token_budget=int(token_budget))
        return _format_hits(hits)

    @tool
    def propose_update(
        incoming_text: str,
        source_kind: str,
        source_url: str = "",
        source_timestamp: str = "",
    ) -> str:
        """
        Build a ReconciliationPlan for a new piece of incoming context.

        Runs fact extraction (LLM with heuristic fallback) over `incoming_text`,
        retrieves related sections via the shared Retriever, and emits a JSON
        plan describing exactly which operations should change the working
        brain (append / supersede / flag_conflict / ignore / create_section).

        Does NOT mutate any brain files: it only returns the plan and appends
        it to `<brain_root>/.audit/log.jsonl` for traceability. Hand the plan
        to a human reviewer or to `replace_working_file` to apply.

        `source_kind` should be one of: merged_pr, adr, decision_log, manual,
        meeting, review_comment, issue, slack, demo (drives source authority).
        """
        from .update import Reconciler

        try:
            retriever = _get_retriever(wk if wk.is_dir() else ref)
        except FileNotFoundError as exc:
            return f"propose_update refused: {exc}"

        rec = Reconciler(retriever=retriever)
        plan = rec.reconcile(
            incoming_text,
            source={
                "kind": source_kind,
                "url": source_url,
                "timestamp": source_timestamp,
            },
        )
        return json.dumps(plan.to_dict(), ensure_ascii=False, indent=2)

    @tool
    def delete_working_file(relative_path: str) -> str:
        """
        Permanently delete a Markdown file from the working brain.

        Removes the file, prunes any now-empty parent directories up to the brain
        root, invalidates the retrieval index, and reports other files that linked
        to the deleted path so dangling references can be cleaned up.

        Use this whenever the user explicitly requests a file be deleted or removed.
        NEVER substitute upsert/replace with empty content — use this tool instead.
        """
        p = _safe_join(wk, relative_path)
        if not p.is_file():
            return f"File not found: {relative_path}"
        if p.suffix.lower() != ".md":
            return "Refuse: only .md files may be deleted"

        # Detect backlinks before deleting
        stem = relative_path.removesuffix(".md")
        backlinks: list[str] = []
        for other_rel in _iter_markdown_files(wk):
            if other_rel == relative_path:
                continue
            try:
                text = _read_text(wk / other_rel)
                if relative_path in text or stem in text:
                    backlinks.append(other_rel)
            except Exception:
                pass

        p.unlink()
        retrieval_service.invalidate(wk)

        # Prune empty parent directories up to the brain root
        try:
            parent = p.parent
            wk_resolved = wk.resolve()
            while parent.resolve() != wk_resolved and parent.is_dir():
                if not any(parent.iterdir()):
                    parent.rmdir()
                    parent = parent.parent
                else:
                    break
        except Exception:
            pass

        msg = f"Deleted {relative_path}."
        if backlinks:
            msg += (
                f" ⚠ {len(backlinks)} file(s) may have dangling links: "
                + ", ".join(backlinks[:5])
                + ("…" if len(backlinks) > 5 else "")
                + ". Consider updating them."
            )
        return msg

    @tool
    def delete_working_directory(relative_dir: str) -> str:
        """
        Permanently delete a directory and ALL Markdown files within it from the
        working brain.

        Returns a summary of deleted files. Refuses if the target is the brain root
        or if it would delete more than 50 files (to avoid accidental mass removal —
        delete files individually in that case).

        Use only when the user explicitly asks to remove an entire folder/section.
        """
        import shutil

        # Normalise — strip trailing slashes
        rel = relative_dir.rstrip("/")
        d = _safe_join(wk, rel)
        if not d.is_dir():
            return f"Directory not found: {relative_dir}"
        if d.resolve() == wk.resolve():
            return "Refuse: cannot delete the brain root directory"

        files = _iter_markdown_files(d)
        if len(files) > 50:
            return (
                f"Refuse: would delete {len(files)} files — that exceeds the safety "
                "limit of 50. Delete sub-directories or files individually."
            )

        shutil.rmtree(d)
        retrieval_service.invalidate(wk)

        if files:
            return (
                f"Deleted directory '{rel}' and {len(files)} file(s): "
                + ", ".join(files[:10])
                + ("…" if len(files) > 10 else "")
            )
        return f"Deleted empty directory '{rel}'."

    @tool
    def move_working_file(source_path: str, dest_path: str) -> str:
        """
        Move (rename) a Markdown file within the working brain.

        Creates any missing parent directories for the destination, updates the
        `id` frontmatter field to match the new path (if present), and reports
        other files that linked to the old path so those references can be updated.

        Use this when the user wants to rename or reorganise a file.
        """
        import re as _re

        src = _safe_join(wk, source_path)
        if not src.is_file():
            return f"File not found: {source_path}"
        if src.suffix.lower() != ".md":
            return "Refuse: only .md files may be moved"

        dst = _safe_join(wk, dest_path)
        if dst.suffix.lower() != ".md":
            return "Refuse: destination must be a .md path"
        if dst.exists():
            return f"Refuse: destination already exists: {dest_path}"

        # Detect backlinks before moving
        stem = source_path.removesuffix(".md")
        backlinks: list[str] = []
        for other_rel in _iter_markdown_files(wk):
            if other_rel == source_path:
                continue
            try:
                text = _read_text(wk / other_rel)
                if source_path in text or stem in text:
                    backlinks.append(other_rel)
            except Exception:
                pass

        dst.parent.mkdir(parents=True, exist_ok=True)
        content = src.read_text(encoding="utf-8", errors="replace")

        # Update the `id:` frontmatter field to match the new path
        new_id = dest_path.removesuffix(".md").replace("\\", "/")
        if content.startswith("---\n") or content.startswith("---\r\n"):
            m = _re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", content, _re.DOTALL)
            if m:
                fm_raw = m.group(1)
                if _re.search(r"^id:", fm_raw, _re.MULTILINE):
                    fm_raw = _re.sub(r"^id:.*$", f"id: {new_id}", fm_raw, flags=_re.MULTILINE)
                    content = f"---\n{fm_raw}\n---\n{content[m.end():]}"

        dst.write_text(content, encoding="utf-8")
        src.unlink()

        # Prune empty source parent directories
        try:
            parent = src.parent
            wk_resolved = wk.resolve()
            while parent.resolve() != wk_resolved and parent.is_dir():
                if not any(parent.iterdir()):
                    parent.rmdir()
                    parent = parent.parent
                else:
                    break
        except Exception:
            pass

        retrieval_service.invalidate(wk)
        msg = f"Moved {source_path} → {dest_path}."
        if backlinks:
            msg += (
                f" ⚠ {len(backlinks)} file(s) still reference the old path: "
                + ", ".join(backlinks[:5])
                + ("…" if len(backlinks) > 5 else "")
                + ". Update those links manually or call `replace_working_file`."
            )
        return msg

    @tool
    def record_audit(plan_json: str) -> str:
        """
        Persist a ReconciliationPlan JSON blob (e.g. the output of
        `propose_update` or a manually-constructed plan) to the audit log at
        `<brain_root>/.audit/log.jsonl`.

        Use this when the agent assembles a plan across several tool calls and
        wants to record the final, edited version separately from whatever
        `propose_update` produced internally.
        """
        from .update import ReconciliationPlan
        from .update.audit import AuditLog

        try:
            payload = json.loads(plan_json)
        except json.JSONDecodeError as exc:
            return f"record_audit refused: invalid JSON ({exc})"

        try:
            plan = ReconciliationPlan.from_dict(payload)
        except (KeyError, TypeError, ValueError) as exc:
            return f"record_audit refused: not a valid plan ({exc})"

        log = AuditLog(wk if wk.is_dir() else ref)
        entry = log.append(
            {
                "kind": "reconciliation_plan",
                "source": "agent_recorded",
                "plan": plan.to_dict(),
            }
        )
        return f"Recorded plan with {len(plan.operations)} op(s) at {entry.get('timestamp')}."

    return [
        list_reference_brain,
        read_reference_file,
        search_reference_brain,
        list_working_brain,
        read_working_file,
        search_working_brain,
        get_working_frontmatter,
        upsert_working_file,
        replace_working_file,
        delete_working_file,
        delete_working_directory,
        move_working_file,
        semantic_search,
        get_brief,
        propose_update,
        record_audit,
    ]


# Tool routing per agent role. Read tools never mutate; write tools may write
# files OR write the audit log. `propose_update` is on the writer because
# producing a plan is part of the update workflow even though it's read-only
# against the brain itself (it does write to .audit/log.jsonl).
_READER_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "list_reference_brain",
        "read_reference_file",
        "search_reference_brain",
        "list_working_brain",
        "read_working_file",
        "search_working_brain",
        "get_working_frontmatter",
        "semantic_search",
        "get_brief",
    }
)

_UPDATE_READER_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "list_working_brain",
        "read_working_file",
        "list_reference_brain",
        "read_reference_file",
        "search_working_brain",
        "search_reference_brain",
        "semantic_search",
        "get_brief",
    }
)

_WRITER_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "upsert_working_file",
        "replace_working_file",
        "delete_working_file",
        "delete_working_directory",
        "move_working_file",
        "propose_update",
        "record_audit",
    }
)


def build_reader_toolkit(ctx: BrainContext) -> list:
    """Read-side toolkit: file listing/reading + retrieval (no mutations)."""
    return [t for t in build_all_tools(ctx) if t.name in _READER_TOOL_NAMES]


def build_update_reader_toolkit(ctx: BrainContext) -> list:
    """Narrower read-side toolkit for update tasks to avoid tool-looping."""
    return [t for t in build_all_tools(ctx) if t.name in _UPDATE_READER_TOOL_NAMES]


def build_writer_toolkit(ctx: BrainContext) -> list:
    """Write-side toolkit: knowledge-base writes + reconciliation planning + audit."""
    return [t for t in build_all_tools(ctx) if t.name in _WRITER_TOOL_NAMES]
