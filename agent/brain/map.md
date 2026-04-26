---
id: brain.map
type: map
title: Brain Map
status: active
importance: high
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md- brain.index
  - summaries.project_summary
  - projects/team_task_board/overview.md
keywords:
  - graph
  - map
  - backlinks
---

# Brain Knowledge Map

This file is the visual navigation layer for the brain. Humans can use it to understand the project shape. Agents can use it to decide which files to read next.

```mermaid
flowchart LR
  Index["index.md"] --> ProjectSummary["summaries/project_summary.md"]
  Index --> TeamTaskBoardOverview["projects/team_task_board/overview.md"]
```

## Map Rules

- Every important file should be reachable from `index.md` or this map.
- New architecture files should link back to [System Overview](architecture/system_overview.md).
- New durable decisions should link from [Decision Log](decisions/decision_log.md).
- Integration files should link back to [Ingestion Pipeline](architecture/ingestion_pipeline.md).
