---
id: brian.map
type: map
title: Brian Knowledge Map
status: active
importance: high
updated: 2026-04-25
links:
  - brian.index
  - summaries.project_summary
  - architecture.system_overview
keywords:
  - graph
  - map
  - backlinks
---

# Brian Knowledge Map

This file is the visual navigation layer for the brain. Humans can use it to understand the project shape. Agents can use it to decide which files to read next.

```mermaid
flowchart LR
  Index["index.md"] --> ProjectSummary["summaries/project_summary.md"]
  Index --> ArchitectureSummary["summaries/architecture_summary.md"]
  Index --> SystemOverview["architecture/system_overview.md"]
  Index --> RuntimeFlow["architecture/runtime_flow.md"]
  Index --> DecisionLog["decisions/decision_log.md"]
  Index --> CodingPrompt["agents/coding_agent_prompt.md"]

  SystemOverview --> DataModel["architecture/data_model.md"]
  SystemOverview --> RuntimeFlow
  RuntimeFlow --> Ingestion["architecture/ingestion_pipeline.md"]
  RuntimeFlow --> Distillation["architecture/distillation_pipeline.md"]
  RuntimeFlow --> BrainStorage["architecture/brain_storage.md"]

  Ingestion --> GitHub["integrations/github.md"]
  Ingestion --> Slack["integrations/slack.md"]
  Ingestion --> Meetings["integrations/meetings.md"]

  Distillation --> DistillerPrompt["agents/distiller_agent_prompt.md"]
  BrainStorage --> DecisionLog
  DecisionLog --> Constraints["context/constraints.md"]
  DecisionLog --> OpenQuestions["context/open_questions.md"]
```

## Map Rules

- Every important file should be reachable from `index.md` or this map.
- New architecture files should link back to [System Overview](architecture/system_overview.md).
- New durable decisions should link from [Decision Log](decisions/decision_log.md).
- Integration files should link back to [Ingestion Pipeline](architecture/ingestion_pipeline.md).
