---
id: summaries.architecture_summary
type: summary
title: Architecture Summary
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.system_overview
  - architecture.runtime_flow
  - architecture.data_model
  - architecture.brain_storage
keywords:
  - architecture
  - summary
  - retrieval
---

# Architecture Summary

The app is a single Next.js TypeScript application using the App Router.

The main runtime path is:

1. A webhook posts to `/api/ingest/[source]`.
2. The source is verified if a secret is configured.
3. The payload is normalized into a `NormalizedEvent`.
4. The event is stored in Postgres or in memory.
5. The event text is embedded and stored as a searchable document.
6. The distiller decides whether the event is significant.
7. Significant events append Markdown context to a brain file.
8. The brain write commits to GitHub in production or memory in local demo mode.
9. The UI shows events, brain files, integrations, updates, and search results.

## Core Code Locations

- `src/app/api/ingest/[source]/route.ts`: dynamic ingestion route.
- `src/lib/ingest/normalizers.ts`: source-specific payload normalization.
- `src/lib/ingest/security.ts`: webhook signature and token checks.
- `src/lib/distiller/index.ts`: embedding, significance, and brain-update logic.
- `src/lib/db/schema.ts`: Drizzle schema.
- `src/lib/db/store.ts`: database/in-memory storage adapter.
- `src/lib/brain/provider.ts`: GitHub/in-memory brain adapter.
- `src/components/brain-workspace.tsx`: human brain editor.

## Key Design Constraint

The app must work without credentials for demos, but switch to durable production systems when env vars are configured.
