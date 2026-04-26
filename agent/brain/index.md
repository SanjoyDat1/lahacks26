---
id: brain.index
type: index
title: Brain Index
status: active
importance: critical
updated: 2026-04-25
links:
  - map.md
  - summaries/project_summary.md- map.md
  - summaries/project_summary.md
  - projects/iris_landing/overview.md
keywords:
  - source of truth
  - project memory
  - coding agent context
---

# Brain Index

This folder is an example of a structured project brain for the AI Brain application. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

Treat this file as the required entry point. Every generated working brain should include its own `index.md`, and every important generated file should be reachable from this page directly or through [Brain Map](map.md).

## Read Order For Agents

1. Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2. Read [System Overview](architecture/system_overview.md) to understand the product.
3. Read [Product Goals](goals/product_goals.md) and [Constraints](context/constraints.md) before changing scope.
4. Read [Runtime Flow](architecture/runtime_flow.md) before changing ingestion, distillation, brain storage, or UI behavior.
5. Read [Decision Log](decisions/decision_log.md) before making design changes.
6. Read [Coding Agent Prompt](agents/coding_agent_prompt.md) before implementing code.

## Important Links

- [Brain Map](map.md)
- [Project Summary](summaries/project_summary.md)
- [Architecture Summary](summaries/architecture_summary.md)
- [System Overview](architecture/system_overview.md)
- [Data Model](architecture/data_model.md)
- [Runtime Flow](architecture/runtime_flow.md)
- [Ingestion Pipeline](architecture/ingestion_pipeline.md)
- [Distillation Pipeline](architecture/distillation_pipeline.md)
- [Brain Storage](architecture/brain_storage.md)
- [Product Goals](goals/product_goals.md)
- [Decision Log](decisions/decision_log.md)
- [Constraints](context/constraints.md)
- [Open Questions](context/open_questions.md)
- [Coding Agent Prompt](agents/coding_agent_prompt.md)
- [Distiller Agent Prompt](agents/distiller_agent_prompt.md)
- [GitHub Integration](integrations/github.md)
- [Slack Integration](integrations/slack.md)
- [Meetings Integration](integrations/meetings.md)

## Generated Brain Files

- [projects/iris_landing/architecture.md](projects/iris_landing/architecture.md)
- [projects/iris_landing/data_model.md](projects/iris_landing/data_model.md)
- [projects/iris_landing/timeline.md](projects/iris_landing/timeline.md)
- [projects/iris_landing/open_questions.md](projects/iris_landing/open_questions.md)
