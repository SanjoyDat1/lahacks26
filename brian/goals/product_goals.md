---
id: goals.product_goals
type: goals
title: Product Goals
status: active
importance: high
updated: 2026-04-25
links:
  - summaries.project_summary
  - architecture.system_overview
keywords:
  - goals
  - product
  - launch
---

# Product Goals

## Primary Goal

Bridge the gap between human project context and LLM coding agents by maintaining a shared, auditable, human-readable source of truth.

## User-Facing Goals

- Let teams connect project communication sources quickly.
- Show what the system knows and why it knows it.
- Let humans edit the project brain directly.
- Make AI brain updates auditable through Git commits.
- Help coding agents retrieve the right context before making changes.

## Launch Goals

- Run locally with no credentials.
- Deploy cleanly to Vercel.
- Support Postgres persistence.
- Support real webhook-shaped ingestion.
- Provide a clear demo path.

## Non-Goals For The First Version

- Full enterprise auth.
- Multi-tenant billing.
- Perfect source-specific webhook coverage.
- Real-time background queue infrastructure.
- Human review workflow for every AI brain update.
