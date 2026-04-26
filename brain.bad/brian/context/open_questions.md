---
id: context.open_questions
type: context
title: Open Questions
status: active
importance: medium
updated: 2026-04-25
links:
  - architecture.distillation_pipeline
  - architecture.brain_storage
keywords:
  - open questions
  - unknowns
  - future work
---

# Open Questions

## Product Questions

- Should AI-generated brain updates require human approval before GitHub commits?
- Should the app support multiple separate brains for multiple projects?
- Should users be able to mark specific Slack or Discord channels as authoritative?

## Architecture Questions

- Should distillation run synchronously in the API route or move to a queue?
- Should brain files use wiki links, Markdown links, or both?
- Should the generated map be updated automatically after every brain write?

## Retrieval Questions

- What is the ideal chunking strategy for long meeting transcripts?
- Should summary files be generated from the detailed files on a schedule?
- How should stale or superseded context be marked so agents avoid old assumptions?
