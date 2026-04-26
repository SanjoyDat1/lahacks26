---
id: decisions.decision_log
type: decision_log
title: Decision Log
status: active
importance: critical
updated: 2026-04-25
links:
  - decisions.ADR-0001-git-backed-brain
  - decisions.ADR-0002-local-demo-fallbacks
  - architecture.system_overview
keywords:
  - decisions
  - ADR
  - rationale
---

# Decision Log

This file lists durable product and architecture decisions. Detailed decisions should live in ADR files.

## Active Decisions

| ID | Decision | Status | Link |
| --- | --- | --- | --- |
| ADR-0001 | Use GitHub-backed Markdown as the production brain | Accepted | [ADR-0001](ADR-0001-git-backed-brain.md) |
| ADR-0002 | Keep local demo fallbacks for all external dependencies | Accepted | [ADR-0002](ADR-0002-local-demo-fallbacks.md) |

## Decision Rules

- Do not delete old decisions.
- If a decision changes, write a new ADR that supersedes the previous one.
- Link decisions to impacted architecture files.
- Keep decisions short enough that agents can scan them quickly.
