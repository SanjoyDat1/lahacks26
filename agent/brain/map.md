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
keywords:
  - graph
  - map
  - backlinks
---

# Brain Map

This file is the visual navigation layer for the brain. Humans can use it to understand the project shape. Agents can use it to decide which files to read next.

```mermaid
flowchart LR
  Index["index.md"] --> ProjectSummary["summaries/project_summary.md"]
  Index --> Overview["projects/iris_landing/overview.md"]

  ProjectSummary --> SystemOverview["architecture/system_overview.md"]
  SystemOverview --> DataModel["architecture/data_model.md"]
  SystemOverview --> RuntimeFlow["architecture/runtime_flow.md"]
  RuntimeFlow --> Ingestion["architecture/ingestion_pipeline.md"]
  RuntimeFlow --> Distillation["architecture/distillation_pipeline.md"]
  RuntimeFlow --> BrainStorage["architecture/brain_storage.md"]

  Ingestion --> GitHub["integrations/github.md"]
  Ingestion --> Slack["integrations/slack.md"]
  Ingestion --> Meetings["integrations/meetings.md"]

  Distillation --> DistillerPrompt["agents/distiller_agent_prompt.md"]
  BrainStorage --> DecisionLog["decisions/decision_log.md"]
  DecisionLog --> Constraints["context/constraints.md"]
  DecisionLog --> OpenQuestions["context/open_questions.md"]
```

## Map Rules

- Every important file should be reachable from `index.md` or this map.
- New architecture files should link back to [System Overview](architecture/system_overview.md).
- New durable decisions should link from [Decision Log](decisions/decision_log.md).
- Integration files should link back to [Ingestion Pipeline](architecture/ingestion_pipeline.md).
