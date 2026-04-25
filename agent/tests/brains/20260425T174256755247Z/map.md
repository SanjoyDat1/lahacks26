---
id: campuscompanion.map
type: map
title: CampusCompanion Knowledge Map
status: active
importance: high
updated: 2026-04-25
links:
  - campuscompanion.index
  - summaries.project_summary
  - goals.product_goals
  - decisions.decision_log
  - context.constraints
  - context.open_questions
  - campuscompanion.map
keywords:
  - graph
  - map
  - backlinks
---

# CampusCompanion Knowledge Map

This file is the visual navigation layer for the CampusCompanion brain. Humans can use it to understand the project shape. Agents can use it to decide which files to read next.

```mermaid
flowchart LR
  Index["index.md"] --> ProjectSummary["summaries/project_summary.md"]
  Index --> ProductGoals["goals/product_goals.md"]
  Index --> DecisionLog["decisions/decision_log.md"]
  Index --> Constraints["context/constraints.md"]
  Index --> OpenQuestions["context/open_questions.md"]

  ProjectSummary --> ProductGoals
  ProductGoals --> Constraints
  ProductGoals --> OpenQuestions
  DecisionLog --> Constraints
  DecisionLog --> OpenQuestions
  Constraints --> OpenQuestions
```

## Map Rules

- Every important file should be reachable from `index.md` or this map.
- New durable decisions should link from [Decision Log](decisions/decision_log.md).
- New constraints should link from [Constraints](context/constraints.md).
- New open questions should link from [Open Questions](context/open_questions.md).
