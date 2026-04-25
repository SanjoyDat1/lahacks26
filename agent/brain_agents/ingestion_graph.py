"""Explicit LangGraph workflow for brain initialize (bootstrap) and update."""

from __future__ import annotations

import json
import logging
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator, Literal, cast

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph, START

from .builder import (
    DocumentInput,
    SourceDocument,
    create_brain_from_documents,
    create_brain_from_documents_streaming,
    normalize_documents,
)
from .builder import _source_digest
from .config import Settings
from .ingestion_state import IngestionState
from .llm import invoke_chat_model, make_chat_model
from .services.reconciliation_apply import apply_reconciliation_plan, apply_single_operation, resolve_brain_root
from .services.retrieval_service import retrieval_service
from .update import ReconciliationPlan, Reconciler

logger = logging.getLogger(__name__)


def _log_graph(message: str) -> None:
    logger.info(message)
    print(f"[brain-agent] graph: {message}", file=sys.stderr, flush=True)


def _retrieval_backend_kwargs(settings: Settings) -> dict[str, bool]:
    prefer_dense = bool(getattr(settings, "retrieval_dense_enabled", True))
    return {
        "prefer_dense": prefer_dense,
        "prefer_cross_encoder": prefer_dense,
    }


def _after_distill_router(state: IngestionState) -> Literal["init", "update"]:
    mode = state.get("flow_mode", "update")
    _log_graph(f"routing after distill flow_mode={mode}")
    if mode == "initialize":
        return "init"
    return "update"


def _normalize_node(state: IngestionState) -> dict[str, Any]:
    _log_graph(f"normalize START flow_mode={state.get('flow_mode', 'update')}")
    s = state.get("settings")
    if s is None:
        _log_graph("normalize FAILED settings missing")
        return {"error": "settings missing", "result_text": "Internal error: settings missing."}
    flow = state.get("flow_mode", "update")
    try:
        if flow == "initialize":
            inputs: list[DocumentInput] = list(
                state.get("document_inputs") or []
            ) or [state.get("initial_prompt", "")]
            docs = normalize_documents(inputs)
            _log_graph(f"normalize loaded initialize docs={len(docs)}")
        else:
            prompt = str(state.get("update_prompt", "")).strip()
            if not prompt:
                _log_graph("normalize FAILED empty update prompt")
                return {"error": "empty_update_prompt", "result_text": "No update text was provided."}
            docs = [SourceDocument(name="user-prompt", text=prompt)]
            _log_graph(f"normalize loaded update prompt chars={len(prompt)}")
    except (ValueError, OSError) as exc:
        _log_graph(f"normalize FAILED error={exc}")
        return {
            "error": str(exc),
            "result_text": f"Could not normalize input: {exc}",
        }
    _log_graph(f"normalize END docs={len(docs)}")
    return {"normalized_docs": docs, "error": None}


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()


def _distill_node(state: IngestionState) -> dict[str, Any]:
    if state.get("error"):
        _log_graph(f"distill SKIP prior_error={state.get('error')}")
        return {}
    _log_graph(f"distill START flow_mode={state.get('flow_mode', 'update')}")
    docs = list(state.get("normalized_docs", []))
    if not docs:
        _log_graph("distill FAILED no documents")
        return {
            "error": "no_documents",
            "result_text": "No documents to process.",
        }
    raw = _source_digest(docs)
    s = state["settings"]
    flow = state.get("flow_mode", "update")

    if flow == "initialize":
        _log_graph(f"distill END initialize raw context preserved raw_chars={len(raw)}")
        return {"cleaned_context": raw, "source_digest": raw}

    if flow == "update" and state.get("update_mode") == "deterministic":
        _log_graph(f"distill END deterministic update bypass raw_chars={len(raw)}")
        return {"cleaned_context": raw, "source_digest": raw}

    if not (getattr(s, "openai_api_key", "") or "").strip():
        _log_graph(f"distill END no OpenAI key bypass raw_chars={len(raw)}")
        return {"cleaned_context": raw, "source_digest": raw}

    system = SystemMessage(
        content=(
            "You are cleaning raw text for a project knowledge base. "
            "Remove chit-chat, sign-offs, duplicate headers, meeting logistics noise, and formatting junk. "
            "Keep paraphrased facts: decisions, constraints, open questions, blockers, ownership, dates, and links. "
            "Return ONLY a JSON object: {\"distilled_text\": string} — no markdown fences."
        )
    )
    user = HumanMessage(
        content=f"Text to clean (may be long):\n\n{raw[:42000]}\n"
    )
    try:
        model = make_chat_model(s)
        resp = invoke_chat_model(
            model,
            [system, user],
            label="distill document for KB",
        )
        text = cast(str, getattr(resp, "content", resp) or "")
        if isinstance(text, list):
            text = "".join(
                str(p.get("text", p)) if isinstance(p, dict) else str(p) for p in text
            )
        cleaned = _strip_json_fence(str(text))
        data = json.loads(cleaned)
        if isinstance(data, dict) and isinstance(data.get("distilled_text"), str):
            d = str(data["distilled_text"]).strip()
            if d:
                _log_graph(f"distill END cleaned_chars={len(d)} raw_chars={len(raw)}")
                return {"cleaned_context": d, "source_digest": raw}
    except (json.JSONDecodeError, OSError, TypeError, ValueError) as exc:
        _log_graph(f"distill FALLBACK raw context after error={type(exc).__name__}: {exc}")
        pass
    _log_graph(f"distill END fallback raw_chars={len(raw)}")
    return {"cleaned_context": raw, "source_digest": raw}


def _bootstrap_write_node(state: IngestionState) -> dict[str, Any]:
    if state.get("error"):
        _log_graph(f"bootstrap_write SKIP prior_error={state.get('error')}")
        return {}
    _log_graph("bootstrap_write START")
    s = state["settings"]
    text = (state.get("cleaned_context") or "").strip()
    docs: list[SourceDocument]
    if text:
        docs = [SourceDocument(name="distilled-context", text=text)]
    else:
        docs = list(state.get("normalized_docs", []))
    try:
        written = create_brain_from_documents(
            docs,
            settings=s,
            initial_prompt=state.get("initial_prompt", ""),
            max_files=int(state.get("max_files", 3) or 3),
            overwrite=bool(state.get("overwrite", False)),
        )
    except (OSError, FileExistsError, ValueError) as exc:  # noqa: BLE001
        _log_graph(f"bootstrap_write FAILED error={exc}")
        return {
            "error": str(exc),
            "result_text": f"Bootstrap write failed: {exc}",
        }
    retrieval_service.invalidate(resolve_brain_root(s))
    _log_graph(f"bootstrap_write END files={sorted(written)}")
    return {"written_map": written, "error": state.get("error")}


def _retrieve_node(state: IngestionState) -> dict[str, Any]:
    if state.get("error"):
        _log_graph(f"retrieve SKIP prior_error={state.get('error')}")
        return {}
    _log_graph("retrieve START")
    s = state["settings"]
    if not bool(getattr(s, "retrieval_enabled", True)):
        _log_graph("retrieve END disabled by RETRIEVAL_ENABLED=false")
        return {
            "retrieval_hits": [],
            "candidate_files": [],
        }
    q = (state.get("cleaned_context") or state.get("update_prompt", "")).strip()
    if not q:
        _log_graph("retrieve END empty query")
        return {
            "retrieval_hits": [],
            "candidate_files": [],
        }
    root = s.brain_dir if s.brain_dir.is_dir() else s.brian_reference_dir
    try:
        retriever = retrieval_service.get(root, **_retrieval_backend_kwargs(s))
        hits = retriever.query(q, top_k=6, token_budget=1500)
    except (FileNotFoundError, OSError, ValueError) as exc:  # noqa: BLE001
        _log_graph(f"retrieve END failed error={exc}")
        return {
            "retrieval_hits": [],
            "candidate_files": [],
            "verify_line": f"(retrieval warm-up failed: {exc})",
        }
    seen: set[str] = set()
    files: list[str] = []
    serial: list[dict[str, Any]] = []
    for h in hits:
        serial.append(retrieval_service.hit_to_dict(h))  # type: ignore[attr-defined, arg-type]
        fp = getattr(h, "file_path", None) or ""
        if fp and fp not in seen:
            seen.add(fp)
            files.append(fp)
    return {
        "retrieval_hits": serial,
        "candidate_files": files,
    }


def _reconcile_node(state: IngestionState) -> dict[str, Any]:
    if state.get("error"):
        _log_graph(f"reconcile SKIP prior_error={state.get('error')}")
        return {"plan": None}
    _log_graph(f"reconcile START update_mode={state.get('update_mode', 'llm')}")
    s = state["settings"]
    root = s.brain_dir if s.brain_dir.is_dir() else s.brian_reference_dir
    incoming = (state.get("cleaned_context") or state.get("update_prompt", "")).strip()
    use_llm: bool | str = "auto" if str(state.get("update_mode", "llm") or "llm") == "llm" else False
    try:
        retriever = retrieval_service.get(root, **_retrieval_backend_kwargs(s))
    except (FileNotFoundError, OSError) as exc:  # noqa: BLE001
        _log_graph(f"reconcile FAILED error={exc}")
        return {
            "error": str(exc),
            "plan": None,
            "result_text": f"Reconcile could not open brain index: {exc}",
        }
    rec = Reconciler(retriever=retriever, use_llm=use_llm)
    plan = rec.reconcile(incoming, source=state.get("source", {}) or {})
    _log_graph(f"reconcile END ops={len(plan.operations)} confidence={plan.confidence}")
    return {"plan": plan, "error": state.get("error")}


def _apply_node(state: IngestionState) -> dict[str, Any]:
    if state.get("error"):
        _log_graph(f"apply SKIP prior_error={state.get('error')}")
        return {}
    _log_graph(f"apply START do_apply={state.get('do_apply', True)}")
    s = state["settings"]
    plan: ReconciliationPlan | None = state.get("plan")
    if not state.get("do_apply", True):
        _log_graph("apply END skipped apply=false")
        return {
            "applied_result_ops": 0,
            "applied_files": [],
        }
    if not plan or not s.brain_dir.is_dir():
        _log_graph("apply END no plan or missing brain dir")
        return {
            "applied_result_ops": 0,
            "applied_files": [],
        }
    res = apply_reconciliation_plan(plan, settings=s)
    _log_graph(f"apply END applied_ops={res.applied_ops} files={sorted(res.files_touched)}")
    return {
        "applied_result_ops": int(res.applied_ops),
        "applied_files": sorted(res.files_touched),
    }


def _verify_node(state: IngestionState) -> dict[str, Any]:
    _log_graph("verify START")
    s = state["settings"]
    try:
        retrieval_service.invalidate(resolve_brain_root(s))
    except (OSError, TypeError) as exc:  # noqa: BLE001
        _log_graph(f"verify END invalidate failed error={exc}")
        return {"verify_line": f"invalidate: {exc}"}
    if state.get("error"):
        _log_graph(f"verify END prior_error={state.get('error')}")
        return {}
    q = (state.get("cleaned_context") or state.get("update_prompt", ""))[:2000]
    if not (q and q.strip()) or state.get("flow_mode") == "initialize":
        _log_graph("verify END cache invalidated")
        return {"verify_line": "cache invalidated; brain ready for retrieval."}
    root = s.brain_dir if s.brain_dir.is_dir() else s.brian_reference_dir
    try:
        retriever = retrieval_service.get(root, **_retrieval_backend_kwargs(s))
        hits = retriever.query(q[:2000], top_k=1, token_budget=400)
        if hits:
            h = hits[0]
            return {
                "verify_line": f"smoke: top hit {getattr(h, 'file_path', '')} "
                f"(rerank={getattr(h, 'rerank_score', 0):.2f})",
            }
    except (FileNotFoundError, OSError, ValueError) as exc:  # noqa: BLE001
        _log_graph(f"verify END query skipped error={exc}")
        return {"verify_line": f"verify query skipped: {exc}"}
    _log_graph("verify END no hits")
    return {"verify_line": "index warm; no hits for smoke query."}


def _final_node(state: IngestionState) -> dict[str, Any]:
    _log_graph("final START")
    if state.get("result_text"):
        _log_graph("final END existing result_text")
        return {}
    if state.get("error"):
        _log_graph(f"final END error={state.get('error', 'unknown error')}")
        return {"result_text": str(state.get("error", "unknown error"))}
    if state.get("flow_mode") == "initialize" and not state.get("error"):
        wm = state.get("written_map", {})
        paths = ", ".join(sorted(wm.keys())) or "(no files)"
        v = state.get("verify_line", "")
        return {
            "result_text": (
                f"Initialized working brain. Wrote {len(wm)} file(s): {paths}. {v}"
            )
        }
    if state.get("flow_mode") == "update" and not state.get("error"):
        plan: ReconciliationPlan | None = state.get("plan")
        if not plan:
            umode = str(state.get("update_mode", "llm") or "llm").lower()
            if umode == "deterministic":
                return {"result_text": ""}
            return {"result_text": "No reconciliation plan was produced."}
        umode = str(state.get("update_mode", "llm") or "llm").lower()
        if umode == "deterministic":
            return {"result_text": ""}
        lines = [f"Plan: {len(plan.operations)} operation(s). {plan.rationale[:400]}"]
        lines.append(
            f"Applied ops: {state.get('applied_result_ops', 0)}. "
            f"Files: {', '.join(state.get('applied_files', []) or []) or 'none'}"
        )
        v = state.get("verify_line", "")
        if v:
            lines.append(f"Verify: {v}")
        if not state.get("do_apply", True):
            return {"result_text": "\n".join(lines) + " (apply=false)"}
        return {"result_text": "\n".join(lines)}
    return {}


@lru_cache(maxsize=1)
def get_ingestion_workflow() -> object:
    graph = StateGraph(IngestionState, name="brain_ingestion")
    graph.add_node("normalize", _normalize_node)  # type: ignore[typeddict-item]
    graph.add_node("distill", _distill_node)
    graph.add_node("bootstrap_write", _bootstrap_write_node)
    graph.add_node("retrieve", _retrieve_node)
    graph.add_node("reconcile", _reconcile_node)
    graph.add_node("apply", _apply_node)
    graph.add_node("verify", _verify_node)
    graph.add_node("final", _final_node)

    graph.add_edge(START, "normalize")
    graph.add_edge("normalize", "distill")
    graph.add_conditional_edges(
        "distill",
        _after_distill_router,
        {"init": "bootstrap_write", "update": "retrieve"},
    )
    graph.add_edge("bootstrap_write", "verify")
    graph.add_edge("retrieve", "reconcile")
    graph.add_edge("reconcile", "apply")
    graph.add_edge("apply", "verify")
    graph.add_edge("verify", "final")
    graph.add_edge("final", END)
    return graph.compile(name="ingestion_v1")


def run_initialize(
    document_inputs: list[DocumentInput],
    *,
    initial_prompt: str,
    settings: Settings,
    max_files: int = 3,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Entry: bootstrap / create working brain from documents."""
    _log_graph(f"run_initialize START max_files={max_files} overwrite={overwrite}")
    if max_files < 1:
        raise ValueError("max_files must be at least 1")
    s = settings
    inputs = list(document_inputs) if document_inputs else [initial_prompt]
    st: IngestionState = cast(
        IngestionState,
        {
            "flow_mode": "initialize",
            "settings": s,
            "document_inputs": inputs,
            "initial_prompt": initial_prompt,
            "max_files": max_files,
            "overwrite": overwrite,
        },
    )
    wf: Any = get_ingestion_workflow()
    out: dict[str, Any] = cast(dict[str, Any], wf.invoke(st))
    wm = out.get("written_map") or {}
    _log_graph(f"run_initialize END files={sorted(wm.keys()) if isinstance(wm, dict) else []}")
    return {
        "written_files": sorted(wm.keys()) if isinstance(wm, dict) else [],
        "result_text": str(out.get("result_text", "")),
    }


def _event(type_: str, **payload: Any) -> dict[str, Any]:
    if "from_" in payload:
        payload["from"] = payload.pop("from_")
    return {"type": type_, **payload}


def _file_preview(path: Path) -> tuple[str, str]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "", ""
    title = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            title = stripped.removeprefix("# ").strip()
            break
        if stripped.startswith("title:"):
            title = stripped.removeprefix("title:").strip().strip('"')
    preview = " ".join(
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("---")
    )[:220]
    return title, preview


def _directory_snapshot(root: Path) -> list[dict[str, Any]]:
    def walk(path: Path) -> dict[str, Any]:
        children: list[dict[str, Any]] = []
        if path.is_dir():
            for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
                if child.name.startswith("."):
                    continue
                if child.is_dir() or child.suffix.lower() == ".md":
                    children.append(walk(child))
        return {
            "name": path.name,
            "path": str(path.relative_to(root.parent)).replace("\\", "/"),
            "type": "directory" if path.is_dir() else "file",
            "children": children,
        }

    if not root.exists():
        return []
    return [walk(root)]


def run_initialize_streaming(
    document_inputs: list[DocumentInput],
    *,
    initial_prompt: str,
    settings: Settings,
    max_files: int = 24,
    overwrite: bool = True,
) -> Iterator[dict[str, Any]]:
    """Streaming initialize flow for the hackathon session-start experience."""
    if max_files < 1:
        yield _event("error", message="max_files must be at least 1")
        return

    st: IngestionState = cast(
        IngestionState,
        {
            "flow_mode": "initialize",
            "settings": settings,
            "document_inputs": list(document_inputs) if document_inputs else [initial_prompt],
            "initial_prompt": initial_prompt,
            "max_files": max_files,
            "overwrite": overwrite,
        },
    )

    yield _event("stage_start", stage="normalize", label="Scanning source context")
    yield _event("graph_node", id="documents", label="Codebase & sources", status="active")
    yield _event("graph_node", id="normalize", label="Normalize", status="active")
    yield _event("graph_edge", from_="documents", to="normalize", status="active")
    yield _event(
        "thinking",
        content="I am reading repository excerpts and any uploaded files, normalizing them into clean source documents for the brain.\n",
    )
    norm = _normalize_node(st)
    st.update(norm)
    if st.get("error"):
        yield _event("error", message=str(st["error"]))
        return
    docs = list(st.get("normalized_docs", []))
    for doc in docs:
        yield _event("document", name=doc.name, chars=len(doc.text), status="scanned")
    yield _event("graph_node", id="documents", label="Codebase & sources", status="done")
    yield _event("graph_node", id="normalize", label="Normalize", status="done")
    yield _event("graph_edge", from_="documents", to="normalize", status="done")

    yield _event("stage_start", stage="distill", label="Distilling durable context")
    yield _event("graph_node", id="distill", label="Distill facts", status="active")
    yield _event("graph_edge", from_="normalize", to="distill", status="active")
    yield _event("thinking", content="Now I am separating durable product context from noise: decisions, constraints, goals, owners, and open questions.\n")
    distilled = _distill_node(st)
    st.update(distilled)
    if st.get("error"):
        yield _event("error", message=str(st["error"]))
        return
    for doc in docs:
        yield _event("document", name=doc.name, chars=len(doc.text), status="distilled")
    yield _event("graph_node", id="distill", label="Distill facts", status="done")
    yield _event("graph_edge", from_="normalize", to="distill", status="done")

    yield _event("stage_start", stage="write", label="Creating the brain structure")
    yield _event("graph_node", id="brain_files", label="Brain files", status="active")
    yield _event("graph_edge", from_="distill", to="brain_files", status="active")
    yield _event("thinking", content="I am planning a connected brain from the uploaded context itself. The reference brain guides structure, but the directories and Markdown nodes must match the source material.\n")
    text = (st.get("cleaned_context") or "").strip()
    write_docs = [SourceDocument(name="source-context", text=text)] if text else docs
    written_map: dict[str, str] = {}
    try:
        for writer_event in create_brain_from_documents_streaming(
            write_docs,
            settings=settings,
            initial_prompt=initial_prompt,
            max_files=max_files,
            overwrite=overwrite,
        ):
            event_type = writer_event.get("type")
            rel_path = str(writer_event.get("path", ""))
            if event_type == "file_planned" and rel_path:
                title = str(writer_event.get("title", ""))
                purpose = str(writer_event.get("purpose", ""))
                links = writer_event.get("links", [])
                yield _event("file_planned", path=rel_path, title=title, preview=purpose, links=links if isinstance(links, list) else [])
                yield _event("directory_snapshot", tree=_directory_snapshot(settings.brain_dir))
            elif event_type == "file_writing" and rel_path:
                yield _event("file_writing", path=rel_path, title=str(writer_event.get("title", "")))
            elif event_type == "file_created" and rel_path:
                content = str(writer_event.get("content", ""))
                written_map[rel_path] = content
                title, preview = _file_preview(settings.brain_dir / rel_path)
                yield _event("file_created", path=rel_path, title=title or str(writer_event.get("title", "")), preview=preview)
                yield _event("directory_snapshot", tree=_directory_snapshot(settings.brain_dir))
            elif event_type == "done":
                maybe_written = writer_event.get("written")
                if isinstance(maybe_written, dict):
                    written_map = {str(path): str(content) for path, content in maybe_written.items()}
    except (OSError, FileExistsError, ValueError) as exc:
        _log_graph(f"bootstrap_write FAILED error={exc}")
        yield _event("error", message=f"Bootstrap write failed: {exc}")
        return
    st["written_map"] = written_map
    retrieval_service.invalidate(resolve_brain_root(settings))
    yield _event("graph_node", id="brain_files", label="Brain files", status="done")
    yield _event("graph_edge", from_="distill", to="brain_files", status="done")

    yield _event("stage_start", stage="index", label="Indexing memory for retrieval")
    yield _event("graph_node", id="index", label="Retrieval index", status="active")
    yield _event("graph_edge", from_="brain_files", to="index", status="active")
    yield _event("thinking", content="I am warming the retrieval layer so the observatory and future coding agents can search this brain immediately.\n")

    yield _event("stage_start", stage="verify", label="Verifying the new brain")
    verify = _verify_node(st)
    st.update(verify)
    yield _event("graph_node", id="index", label="Retrieval index", status="done")
    yield _event("graph_edge", from_="brain_files", to="index", status="done")
    yield _event("graph_node", id="ready", label="Brain ready", status="active")
    yield _event("graph_edge", from_="index", to="ready", status="active")
    final = _final_node(st)
    st.update(final)
    if st.get("error"):
        yield _event("error", message=str(st["error"]))
        return
    yield _event("graph_node", id="ready", label="Brain ready", status="done")
    yield _event("graph_edge", from_="index", to="ready", status="done")
    yield _event("directory_snapshot", tree=_directory_snapshot(settings.brain_dir))
    yield _event(
        "done",
        written_files=sorted(written_map.keys()),
        result_text=str(st.get("result_text", "")),
    )


def run_update_streaming(
    document_inputs: list[DocumentInput],
    *,
    settings: Settings,
    update_mode: Literal["llm", "deterministic"] = "llm",
) -> Iterator[dict[str, Any]]:
    """Streaming update flow: normalize new docs, reconcile against existing brain, apply ops."""
    _log_graph(f"run_update_streaming START docs={len(document_inputs)} mode={update_mode}")

    st: IngestionState = cast(
        IngestionState,
        {
            "flow_mode": "update",
            "settings": settings,
            "document_inputs": list(document_inputs),
            "update_mode": update_mode,
            "do_apply": True,
        },
    )

    yield _event("stage_start", stage="normalize", label="Reading new documents")
    yield _event("thinking", content="Scanning the uploaded documents and extracting text content.\n")
    try:
        docs = normalize_documents(list(document_inputs))
    except (ValueError, OSError) as exc:
        _log_graph(f"run_update_streaming normalize FAILED error={exc}")
        yield _event("error", message=f"Could not normalize input: {exc}")
        return
    if not docs:
        yield _event("error", message="No readable documents were provided.")
        return
    st["normalized_docs"] = docs
    for doc in docs:
        yield _event("document", name=doc.name, chars=len(doc.text), status="scanned")
    yield _event("thinking", content=f"Loaded {len(docs)} document(s) with {sum(len(d.text) for d in docs)} characters.\n")

    yield _event("stage_start", stage="distill", label="Distilling new context")
    yield _event("thinking", content="Extracting durable facts from the new documents: decisions, constraints, goals, and key data.\n")

    combined_text = "\n\n".join(d.text for d in docs)
    st["update_prompt"] = combined_text
    st["cleaned_context"] = combined_text

    if update_mode != "deterministic":
        distilled = _distill_node(st)
        st.update(distilled)
        if st.get("error"):
            yield _event("error", message=str(st["error"]))
            return
    for doc in docs:
        yield _event("document", name=doc.name, chars=len(doc.text), status="distilled")

    yield _event("stage_start", stage="reconcile", label="Reconciling against existing brain")
    yield _event("thinking", content="Comparing new information against every section in the current brain to decide what should change.\n")

    s = settings
    root = s.brain_dir if s.brain_dir.is_dir() else s.brian_reference_dir
    incoming = (st.get("cleaned_context") or combined_text).strip()
    use_llm: bool | str = "auto" if update_mode == "llm" else False

    try:
        retriever = retrieval_service.get(root)
    except (FileNotFoundError, OSError) as exc:
        _log_graph(f"run_update_streaming reconcile FAILED error={exc}")
        yield _event("error", message=f"Could not open brain index: {exc}")
        return

    rec = Reconciler(retriever=retriever, use_llm=use_llm)
    plan = rec.reconcile(incoming, source={})

    if not plan.operations:
        yield _event("thinking", content="The new documents did not introduce any information that changes the existing brain. Everything is already up to date.\n")
        yield _event("done", ops_applied=0, files_touched=[], rationale=plan.rationale or "No changes needed.")
        return

    yield _event("thinking", content=f"Found {len(plan.operations)} operation(s) to apply. Confidence: {plan.confidence:.0%}. Rationale: {plan.rationale}\n")

    for op in plan.operations:
        yield _event(
            "op_planned",
            op={
                "kind": op.kind,
                "target_file": op.target_file,
                "target_section_id": op.target_section_id,
                "new_content": (op.new_content or "")[:500],
                "reason": op.reason,
            },
        )

    yield _event("stage_start", stage="apply", label="Applying changes to the brain")
    yield _event("thinking", content="Writing the planned changes into brain files now.\n")

    if not s.brain_dir.is_dir():
        yield _event("error", message="Brain directory does not exist. Create a brain first.")
        return

    # Apply each operation individually so the frontend can visualise them one-by-one
    touched: set[str] = set()
    applied = 0
    for op in plan.operations:
        ok, change_type = apply_single_operation(op, brain_root=s.brain_dir)
        if ok and op.kind != "ignore":
            applied += 1
            touched.add(op.target_file)
        yield _event("op_applied", path=op.target_file, change_type=change_type, success=ok)

    # Invalidate retrieval index once after all ops
    if touched:
        try:
            retrieval_service.invalidate(resolve_brain_root(s))
        except (OSError, TypeError):
            pass

    yield _event("stage_start", stage="verify", label="Re-indexing retrieval")
    yield _event("thinking", content="Invalidating retrieval cache and re-indexing so the updated brain is immediately searchable.\n")

    yield _event("directory_snapshot", tree=_directory_snapshot(s.brain_dir))
    touched_sorted = sorted(touched)
    yield _event(
        "done",
        ops_applied=applied,
        files_touched=touched_sorted,
        rationale=plan.rationale or "",
    )
    _log_graph(f"run_update_streaming END ops={applied} files={touched_sorted}")


def run_update(
    prompt: str,
    *,
    source: dict[str, Any] | None,
    update_mode: Literal["llm", "deterministic"],
    apply: bool,
    settings: Settings,
) -> dict[str, Any]:
    """Entry: reconcile incoming text against the brain, optionally apply."""
    _log_graph(f"run_update START update_mode={update_mode} apply={apply}")
    st: IngestionState = cast(
        IngestionState,
        {
            "flow_mode": "update",
            "settings": settings,
            "update_prompt": prompt,
            "source": dict(source or {}),
            "update_mode": update_mode,
            "do_apply": apply,
        },
    )
    wf: Any = get_ingestion_workflow()
    raw: dict[str, Any] = cast(dict[str, Any], wf.invoke(st))
    plan: ReconciliationPlan | None = raw.get("plan")
    if not isinstance(plan, ReconciliationPlan):
        plan_d: ReconciliationPlan | None = None
    else:
        plan_d = plan

    result: dict[str, Any] = {
        "mode": update_mode,
        "result_text": str(raw.get("result_text", "")),
        "plan": plan_d,
    }
    if not apply:
        _log_graph("run_update END apply=false")
        result["applied"] = None
        result["applied_ops"] = None
        result["files_touched"] = None
        return result
    if plan_d is None or not settings.brain_dir.is_dir():
        _log_graph("run_update END not applied")
        result["applied"] = False
        result["applied_ops"] = 0
        result["files_touched"] = []
        return result
    result["applied"] = True
    result["applied_ops"] = int(raw.get("applied_result_ops", 0) or 0)
    result["files_touched"] = list(raw.get("applied_files", []))
    _log_graph(
        f"run_update END applied_ops={result['applied_ops']} files={result['files_touched']}"
    )
    return result


__all__ = [
    "get_ingestion_workflow",
    "run_initialize",
    "run_initialize_streaming",
    "run_update",
    "run_update_streaming",
    "IngestionState",
]
