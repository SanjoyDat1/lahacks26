"""Explicit LangGraph workflow for brain initialize (bootstrap) and update."""

from __future__ import annotations

import json
import logging
import re
import sys
from functools import lru_cache
from typing import Any, Literal, cast

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph, START

from .builder import (
    DocumentInput,
    SourceDocument,
    create_brain_from_documents,
    normalize_documents,
)
from .builder import _source_digest
from .config import Settings
from .ingestion_state import IngestionState
from .llm import invoke_chat_model, make_chat_model
from .services.reconciliation_apply import apply_reconciliation_plan, resolve_brain_root
from .services.retrieval_service import retrieval_service
from .update import ReconciliationPlan, Reconciler

logger = logging.getLogger(__name__)


def _log_graph(message: str) -> None:
    logger.info(message)
    print(f"[brain-agent] graph: {message}", file=sys.stderr, flush=True)


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
    q = (state.get("cleaned_context") or state.get("update_prompt", "")).strip()
    if not q:
        _log_graph("retrieve END empty query")
        return {
            "retrieval_hits": [],
            "candidate_files": [],
        }
    root = s.brain_dir if s.brain_dir.is_dir() else s.brian_reference_dir
    try:
        retriever = retrieval_service.get(root)
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
        retriever = retrieval_service.get(root)
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
        retriever = retrieval_service.get(root)
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
    "run_update",
    "IngestionState",
]
