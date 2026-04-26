---
id: brian.index
type: index
title: Brian Project Brain
status: active
importance: critical
updated: 2026-04-25
links:
  - summaries.project_summary
  - architecture.system_overview
  - architecture.data_model
  - architecture.runtime_flow
  - architecture.ingestion_pipeline
  - architecture.distillation_pipeline
  - architecture.brain_storage
  - decisions.decision_log
  - goals.product_goals
  - context.constraints
  - context.open_questions
  - agents.coding_agent_prompt
  - agents.distiller_agent_prompt
  - integrations.github
  - integrations.slack
  - integrations.meetings
keywords:
  - source of truth
  - project memory
  - coding agent context
---

# Brian Project Brain

This folder is an example of a structured project brain for the AI Brain application. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

Treat this file as the required entry point. Every generated working brain should include its own `index.md`, and every important generated file should be reachable from this page directly or through [Brain Map](map.md).

## Read Order For Agents

1. Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2. Read [System Overview](architecture/system_overview.md) to understand the product.
3. Read [Product Goals](goals/product_goals.md) and [Constraints](context/constraints.md) before changing scope.
4. Read [Runtime Flow](architecture/runtime_flow.md) before changing ingestion, distillation, brain storage, or UI behavior.
5. Read [Decision Log](decisions/decision_log.md) before making design changes.
6. Read [Coding Agent Prompt](agents/coding_agent_prompt.md) before implementing code.

## Current Product State

AI Brain is a Next.js application that ingests engineering context from external tools, stores normalized events, distills significant events into Markdown brain updates, and lets humans edit the brain through a web UI.

The app works in two modes:

- Local demo mode: no database, no OpenAI key, no GitHub repo required. Data lives in memory.
- Production mode: Postgres stores events and vectors, OpenAI powers embeddings and distillation, and GitHub commits brain updates.

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
- [Git-Backed Brain ADR](decisions/ADR-0001-git-backed-brain.md)
- [Local Demo Fallbacks ADR](decisions/ADR-0002-local-demo-fallbacks.md)
- [Constraints](context/constraints.md)
- [Open Questions](context/open_questions.md)
- [Coding Agent Prompt](agents/coding_agent_prompt.md)
- [Distiller Agent Prompt](agents/distiller_agent_prompt.md)
- [GitHub Integration](integrations/github.md)
- [Slack Integration](integrations/slack.md)
- [Meetings Integration](integrations/meetings.md)
