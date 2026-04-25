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
  - architecture.runtime_flow
  - decisions.decision_log
  - agents.coding_agent_prompt
keywords:
  - source of truth
  - project memory
  - coding agent context
---

# Brian Project Brain

This folder is an example of a structured project brain for the AI Brain application. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

## Read Order For Agents

1. Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2. Read [System Overview](architecture/system_overview.md) to understand the product.
3. Read [Runtime Flow](architecture/runtime_flow.md) before changing ingestion, distillation, brain storage, or UI behavior.
4. Read [Decision Log](decisions/decision_log.md) before making design changes.
5. Read [Coding Agent Prompt](agents/coding_agent_prompt.md) before implementing code.

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
- [Decision Log](decisions/decision_log.md)
- [Open Questions](context/open_questions.md)
