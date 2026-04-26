---
id: architecture.scaling
type: architecture
title: Path to Enterprise Scale
status: design-only
importance: high
updated: 2026-04-25
links:
  - architecture.system_overview
  - architecture.brain_storage
  - architecture.runtime_flow
  - decisions.decision_log
keywords:
  - scaling
  - enterprise
  - governance
  - federation
---

# Path to Enterprise Scale

This document records the design path from the working hackathon v1 to an enterprise-scale deployment of the brain. The current implementation is a working v1 of the core loop (capture → distill → reconcile → apply → retrieve). Sections marked `design-only` are sketches that the architecture admits but that have not been built. Sections marked `implemented` describe code that already lives in the repo.

## Storage Scale

The current retrieval index is in-memory NumPy. It scales comfortably to roughly one thousand sections, which covers most single-team brains for the lifetime of a project. Beyond that the retriever should swap to pgvector without touching its callers.

The `Retriever` interface is the load-bearing contract. As long as `query`, `query_section_ids`, and `all_sections` keep their shapes, the storage backend is free to change. The frontend already runs Postgres with pgvector in production mode (`frontend/src/lib/db/`); the agent backend reuses the same connection in the next iteration. Reference: `agent/brain_agents/retrieval/retriever.py`.

Status: design-only. The interface is stable; the swap is not.

## Organizational Scale

A single brain belongs to a single team. Multiple teams run multiple `Retriever` instances, each scoped to its own `BRAIN_ROOT`. The selector function `agent/brain_agents/services/reconciliation_apply.resolve_brain_root` already chooses between the working `BRAIN_DIR` and the read-only `BRIAN_REFERENCE_DIR`, which is the same shape used for per-team isolation.

Cross-team queries become a routing problem, not a data-sharding problem: a query targeted at "decisions" hits `team-A/brain` and `team-B/brain`, and results are merged at the retrieval layer. Each retriever instance stays small and stateless across instances.

Status: design-only. Multi-tenant routing is not built.

## Governance Scale

Implemented today. The `Reconciler` produces a typed `ReconciliationPlan`; the `gate_plan` function in `agent/brain_agents/update/governance.py` evaluates plan confidence × source authority and tags the plan as either `auto_approved` or `pending_approval`. Auto-approved plans run through `apply_reconciliation_plan` exactly as before. Pending plans skip apply and are persisted under their `plan_id` for human review via `agent/scripts/review_pending.py`.

The `require_approval` flag is opt-in on `UpdateRequest`, so existing callers see no behavior change. This is the natural insertion point for richer policies: role-based access control, two-of-three sign-off on high-impact files, or compliance review for regulated tenants. The gate already takes `confidence_threshold` and `authority_threshold` as parameters, so policy tuning is config, not code.

Status: implemented. RBAC and multi-party sign-off are design-only.

## Source Authority

The `SOURCE_AUTHORITY` dict in `agent/brain_agents/retrieval/authority.py` is a seed: a fixed mapping from source kind (`merged_pr`, `adr`, `slack`, `demo`) to a weight in `[0.0, 1.0]`. The same table is read by retrieval boosting and by the governance gate, which keeps "what the system trusts" defined in exactly one place.

At enterprise scale this becomes tenant-specific configuration. A regulated organization might rank manual edits below merged PRs because audit trails matter more than operator intent. A research organization might do the reverse because individual judgment is the durable artifact and PRs are throwaway. The shape stays the same; only the weights move.

Status: design-only. The lookup table is implemented; per-tenant overrides are not.

## Compliance and PII

Explicitly not shipped. The correct insertion point is `agent/brain_agents/update/extractor.py`, before facts are produced from incoming text. Detecting PII later -- after distillation, after section writes -- means the brain has already absorbed the data and any redaction is forensic rather than preventive.

Redaction policy can live in brain frontmatter (e.g., `status: pii-redacted` blocks reads from agents while preserving the section for auditors). This composes with the existing `status: superseded` convention, which agents already learn to ignore.

Status: design-only.

## Cost Model

Order-of-magnitude per ingested event:

- BGE retrieval: roughly zero. Local embedding model, no per-call API cost.
- Gemini extraction: roughly $0.0005 per call at current token sizes.
- Storage: negligible. Markdown files plus an append-only JSONL audit log.
- Net: roughly $0.001 per event at typical Slack throughput.

Frame this as "the marginal cost of remembering." Headcount, not API spend, is the ceiling on how much context an organization can afford to retain.

## Federation

At multi-organization scale, brains are federated by routing. A query targeting "architectural decisions across the company" hits team-A and team-B brains, results merged at the retrieval layer with authority weights normalized per tenant.

The architecture admits this because `Retriever` is per-brain-root and stateless across instances; nothing in the reconciler or apply layer assumes a singleton brain. The hard part is not data movement -- it is reconciling authority weights when each tenant configured its own.

Status: design-only. Out of scope for v1.

## Open Questions

- Cross-brain query merging when authority weights differ between tenants: should the federator normalize, or should each tenant's weights win inside their own slice of the result set?
- PII detection latency budget: pre-extraction is the correct insertion point but blocks ingestion. What is an acceptable per-event budget before the extractor times out and falls through?
- Whether superseded sections should be physically removed or just `status: superseded` in frontmatter. We currently do the latter so audit trails stay reconstructable; at scale the soft-delete pile may need its own retention policy.
- How to migrate brains across major schema changes (frontmatter shape, section ID format) without rewriting every existing brain in place. A read-side adapter buys time; a one-shot migration script eventually has to run.
