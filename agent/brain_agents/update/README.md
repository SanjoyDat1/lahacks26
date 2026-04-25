# `brain_agents.update`

Reconciliation / update half of the brain pipeline. Given a piece of incoming
context (a Slack message, meeting note, PR description, ADR draft), this
module produces a **`ReconciliationPlan`** describing what should change in
the working brain. Plans are *proposals* — they are appended to an audit log
and returned to the caller; they never mutate brain files directly.

> Sibling module: [`brain_agents.retrieval`](../retrieval/README.md). The
> reconciler depends on a `Retriever` for context lookup but is hot-swappable
> via the `RetrieverLike` Protocol so unit tests inject fakes.

## Public surface

```python
from brain_agents.retrieval import Retriever
from brain_agents.update import Reconciler, ReconciliationPlan, Operation

retriever = Retriever(brain_root=Path("brain"))
reconciler = Reconciler(retriever=retriever)

plan: ReconciliationPlan = reconciler.reconcile(
    incoming_text="Decision: switch from REST to gRPC for user-service.",
    source={"kind": "meeting", "url": "...", "timestamp": "2026-04-25T15:00:00Z"},
)

for op in plan.operations:
    print(op.kind, op.target_file, op.reason)
```

| Symbol | Where | Purpose |
| --- | --- | --- |
| `Reconciler` | `reconciler.py` | Top-level orchestrator. |
| `ReconciliationPlan` | `__init__.py` | List of operations + rationale + confidence + related sections. |
| `Operation` | `__init__.py` | One atomic write decision (`append` / `supersede` / `flag_conflict` / `ignore` / `create_section`). |
| `format_operation` | `__init__.py` | Renders a single op as Markdown for the audit log / chat output. |
| `Fact` / `extract_facts` | `extractor.py` | Atomic-fact extractor with LLM + heuristic fallback. |
| `decide_operations` | `decider.py` | Per-fact decision tree: related-sections + authority -> Operations. |
| `AuditLog` | `audit.py` | JSONL append-only log at `<brain_root>/.audit/log.jsonl`. |

## Pipeline

```text
incoming_text + source
        |
        v
extract_facts (LLM -> heuristic fallback)
        |
        v
for each fact:
  retriever.query(fact.content, top_k=3, token_budget=500)
        |
        v
  decide_operations(fact, related, source)
        |
        v
ReconciliationPlan ----> AuditLog.append(...)
```

## Decision tree (per fact)

Implemented in `decider.decide_operations`:

1. **Top hit is weakly relevant** (entity overlap < 0.10 *or* rerank < 0.40)
   -> route to the typed default file for that fact type
   (`Decision` -> `decisions/decision_log.md`, `Constraint` ->
   `context/constraints.md`, `OpenQuestion` -> `context/open_questions.md`,
   `FailedAttempt` -> `decisions/decision_log.md#failed-attempts`,
   `Convention` -> `architecture/system_overview.md#conventions`). Falls back
   to `create_section` when the file does not yet exist on disk.
2. **No related sections at all** -> same default routing as case (1).
3. **Contradiction** (entity overlap >= 0.30 + negation flip on a shared
   entity, or antonym pair on shared subject) -> two `flag_conflict`
   operations (one on the existing section, one mirrored on the typed
   default file). Optional LLM second-opinion when a chat model is
   available.
4. **Redundant** (dense >= 0.92 + entity overlap >= 0.50) -> one `ignore` op.
5. **Supersede** (entity overlap >= 0.50 + rerank >= 0.55 + incoming
   `source.kind` authority exceeds existing section authority by >= 0.05,
   for `Decision` / `Constraint` facts only) -> one `supersede` op that
   marks the old section `status: superseded` and writes a new section.
6. **Confirms / extends** (default branch) -> one `append` op adding a
   date-stamped bullet to the related section.

Authority weights come from the locked
`brain_agents.retrieval.authority.SOURCE_AUTHORITY` table (the same one
the retriever uses for its blended ranking).

## Offline / fallback behaviour (per ADR-0002)

Every code path is wired to keep working without an API key, GPU, or model
download:

| Component | Primary | Fallback |
| --- | --- | --- |
| Fact extraction (`extractor.extract_facts`) | OpenRouter chat model + `prompts/extract.md` (strict JSON) | Sentence split + keyword-table classifier (5 fact types). |
| Contradiction check (`decider`) | LLM "CONTRADICTS / CONFIRMS / EXTENDS / UNRELATED" | Negation/antonym flip on shared entities. |
| Authority weights | `retrieval.authority.authority_for` | Local mirror in `decider._FALLBACK_AUTHORITY` (kept in sync; used only when retrieval fails to import). |

`Reconciler(use_llm=False)` forces full offline mode for tests and demos.
`Reconciler(use_llm="auto")` (default) uses the LLM when an
`OPENROUTER_API_KEY` is present and silently degrades otherwise.

## Audit log

* Path: `<brain_root>/.audit/log.jsonl` (auto-created).
* One JSON object per line, each tagged with an ISO-8601 UTC timestamp.
* Every `Reconciler.reconcile` call writes one entry containing:
  the input preview (500 chars), the `source` dict, the extracted facts,
  the full plan (`operations` + `rationale` + `confidence`), and whether the
  LLM was used.
* Replay/inspection: `AuditLog(brain_root).entries(since=datetime(...))`.

## Tools wired into `tools.py`

The writer toolkit (`build_writer_toolkit`) now contains:

* `replace_working_file` — original full-file replacement (unchanged).
* `propose_update(incoming_text, source_kind, source_url, source_timestamp)`
  — runs the reconciler and returns the plan as JSON. Persists to the
  audit log automatically.
* `record_audit(plan_json)` — manually persist a plan that the agent
  assembled / edited outside `propose_update`.

## Performance numbers (Windows, Python 3.11, no GPU)

Measured on a stub retriever (so the timings isolate the update module from
the model-loading cost of the real retriever).

| Path | Median | p95 / max | Target |
| --- | --- | --- | --- |
| `AuditLog.append` | **0.18 ms** | 0.50 ms p95 | < 50 ms |
| `Reconciler.reconcile` (heuristic, 2 facts) | **1.30 ms** | 24.63 ms max | < 500 ms |
| `Reconciler.reconcile` (LLM via OpenRouter, 2 facts) | ~1.5 - 3 s | depends on model | < 3 s |

End-to-end with the **real** retriever (BGE small + cross-encoder) on the
94-section `brian/` corpus:

* First-call cold start (BGE weight load + corpus encode): ~480 s including
  network download. After download, cold start is dominated by the
  cross-encoder weight load (~5-10 s).
* Steady-state `reconcile` with cached retriever: dominated by
  `retriever.query` (cross-encoder rerank), ~10-40 s for 2 facts. Use
  `KeywordReranker` for sub-second updates.

## File layout

```
update/
├── __init__.py        # public dataclasses + Reconciler re-export
├── audit.py           # JSONL append-only log
├── decider.py         # per-fact decision tree
├── extractor.py       # text -> Fact list (LLM + heuristic)
├── reconciler.py      # orchestrator
├── prompts/
│   └── extract.md     # LLM extractor system prompt
└── README.md          # this file
```
