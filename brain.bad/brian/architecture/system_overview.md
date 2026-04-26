---
id: architecture.system_overview
type: architecture
title: System Overview
status: active
importance: critical
updated: 2026-04-25
links:
  - summaries.architecture_summary
  - architecture.runtime_flow
  - architecture.data_model
  - architecture.ingestion_pipeline
  - architecture.distillation_pipeline
  - architecture.brain_storage
keywords:
  - system design
  - Next.js
  - pipeline
  - brain
---

# System Overview

AI Brain is a context pipeline for teams that use LLM coding agents.

The product turns unstructured human communication into a structured Markdown brain. The brain becomes the shared source of truth for humans and agents.

## System Role

The app handles five jobs:

1. Capture engineering context from external streams.
2. Normalize source-specific payloads into one event model.
3. Store raw context and searchable embeddings.
4. Distill durable project knowledge into Markdown.
5. Expose a human-editable, Git-auditable brain.

## Main Components

- Ingestion API: accepts webhook events from external tools.
- Store adapter: writes to Postgres when configured, otherwise memory.
- Distiller: embeds text, classifies significance, writes brain updates.
- Brain provider: writes files to GitHub when configured, otherwise memory.
- Product UI: lets humans inspect, search, and edit project memory.

## Current Runtime Modes

### Local Demo Mode

Used when `DATABASE_URL`, `OPENAI_API_KEY`, or GitHub brain env vars are missing or placeholders.

Behavior:

- Events live in memory.
- Brain files live in memory.
- Embeddings are deterministic local vectors.
- Distillation uses keyword heuristics.
- No external setup is required.

### Production Mode

Used when real env vars are configured.

Behavior:

- Postgres stores events, documents, integrations, and brain updates.
- pgvector powers semantic search.
- OpenAI generates embeddings and structured distillation results.
- GitHub stores Markdown brain files and commit history.

## Related Files

- [Runtime Flow](runtime_flow.md)
- [Data Model](data_model.md)
- [Brain Storage](brain_storage.md)
- [Decision Log](../decisions/decision_log.md)
