---
id: architecture.data_model
type: architecture
title: Data Model
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.system_overview
  - architecture.runtime_flow
  - decisions.decision_log
keywords:
  - database
  - schema
  - Postgres
  - pgvector
---

# Data Model

The database schema is defined in `src/lib/db/schema.ts` with Drizzle ORM.

## Tables

### events

Stores normalized raw events from GitHub, GitLab, Slack, Discord, meetings, and manual/demo sources.

Important fields:

- `source`
- `sourceEventId`
- `sourceUrl`
- `actor`
- `title`
- `body`
- `repository`
- `channel`
- `eventType`
- `payload`
- `status`
- `significance`
- `distillerSummary`

### documents

Stores searchable text chunks derived from events.

Important fields:

- `eventId`
- `source`
- `text`
- `sourceUrl`
- `embedding`

The `embedding` column is `vector(1536)` and is intended for pgvector cosine search.

### brain_updates

Stores audit metadata for AI-generated brain updates.

Important fields:

- `eventId`
- `status`
- `rationale`
- `changedFiles`
- `commitSha`
- `diffSummary`

### integrations

Stores source setup state and last-seen event metadata.

## Lookup Strategy

Fast lookup should use this order:

1. `summaries/*.md` for high-level project context.
2. `documents` vector search for source event context.
3. Specific brain files linked from `index.md` or `map.md`.
4. Raw `events.payload` only when source-specific details are needed.

## Current Tradeoff

The memory fallback is intentionally non-durable. It exists so the product can be demoed instantly. Production reliability requires a real `DATABASE_URL`.
