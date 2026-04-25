---
id: brian.index
type: index
title: Team Task Board Project Brain
status: active
importance: critical
updated: 2026-04-25
links:
  - summaries.project_summary
  - architecture.system_overview
  - architecture.runtime_flow
  - decisions.decision_log
keywords:
  - source of truth
  - project memory
  - task management
---

# Team Task Board Project Brain

This folder is an example of a structured project brain for the Team Task Board application. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

Treat this file as the required entry point. Every generated working brain should include its own `index.md`, and every important generated file should be reachable from this page directly or through [Brain Map](map.md).

## Read Order For Agents

1. Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2. Read [System Overview](architecture/system_overview.md) to understand the product.
3. Read [Decision Log](decisions/decision_log.md) before making design changes.
4. Read [Runtime Flow](architecture/runtime_flow.md) before changing API behavior.

## Current Product State

The Team Task Board is a full-stack application consisting of a FastAPI backend and a React frontend. It provides a simple in-memory REST API for task management, allowing users to create tasks and manage their statuses.

## Important Links

- [Project Summary](summaries/project_summary.md)
- [System Overview](architecture/system_overview.md)
- [Runtime Flow](architecture/runtime_flow.md)
- [Decision Log](decisions/decision_log.md)
