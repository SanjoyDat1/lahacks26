---
id: context.open_questions
type: context
title: Open Questions
status: active
importance: medium
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md
  - context/constraints.md
  - decisions/decision_log.md
  - integrations/slack.md
  - integrations/meetings.md
keywords:
  - open questions
  - unknowns
  - future work
---

# Open Questions

This document captures open questions regarding the implementation and behavior of the LA Hacks operations brain, based on discussions and review notes. These are areas where further definition or decision-making is required.

## Brain Architecture & Distillation Questions

- How should the brain distinguish durable decisions from general chat, and what is the defined process for marking uncertain items as open questions?
- What specific strategies should be employed to refine the bootstrap prompt to prevent it from pulling excessive noise from source documents?

## Data Ingestion & Integration Questions

- What is the optimal method for capturing and preserving essential Slack metadata (channel, sender, timestamp, thread link) during ingestion to ensure auditability?
- Should the brain project pursue automated calendar synchronization for meeting ingestion, or should manual transcript uploads remain the primary and default approach, especially for the demo?
