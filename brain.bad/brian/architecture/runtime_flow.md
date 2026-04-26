---
id: architecture.runtime_flow
type: architecture
title: Runtime Flow
status: active
importance: critical
updated: 2026-04-25
links:
  - architecture.system_overview
  - architecture.ingestion_pipeline
  - architecture.distillation_pipeline
  - architecture.brain_storage
keywords:
  - runtime
  - request flow
  - ingestion
  - distillation
---

# Runtime Flow

This file describes what happens when a new piece of human context enters the system.

## Webhook To Brain Update

```mermaid
sequenceDiagram
  participant Source as External Source
  participant API as Ingestion API
  participant Store as Event Store
  participant Distiller as Distiller
  participant Brain as Brain Provider
  participant UI as Product UI

  Source->>API: POST webhook payload
  API->>API: verify signature if configured
  API->>API: normalize payload
  API->>Store: create event
  API->>Distiller: distill event
  Distiller->>Store: create searchable document
  Distiller->>Distiller: classify significance
  alt Significant
    Distiller->>Brain: append Markdown update
    Brain->>Brain: commit to GitHub or memory
    Distiller->>Store: create brain update
  else Not significant
    Distiller->>Store: mark event ignored
  end
  UI->>Store: read events and updates
  UI->>Brain: read brain files
```

## Important Failure Behavior

- If no database is configured, `src/lib/db/store.ts` falls back to memory.
- If no OpenAI key is configured, `src/lib/llm/client.ts` falls back to deterministic embeddings and heuristic distillation.
- If no GitHub brain repo is configured, `src/lib/brain/provider.ts` falls back to memory.
- Placeholder database URLs should be ignored so local demo mode does not attempt a fake network connection.

## Files To Read Before Editing Flow

- `src/app/api/ingest/[source]/route.ts`
- `src/lib/ingest/service.ts`
- `src/lib/distiller/index.ts`
- `src/lib/db/store.ts`
- `src/lib/brain/provider.ts`
