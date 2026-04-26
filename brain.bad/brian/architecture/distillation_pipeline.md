---
id: architecture.distillation_pipeline
type: architecture
title: Distillation Pipeline
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.runtime_flow
  - architecture.brain_storage
  - agents.distiller_agent_prompt
keywords:
  - distillation
  - embeddings
  - significance
  - LLM
---

# Distillation Pipeline

The distillation pipeline decides whether incoming context should change the project brain.

## Current Flow

1. Format the event into canonical text.
2. Generate an embedding for semantic search.
3. Store the canonical text as a document.
4. Read the existing brain files.
5. Ask the LLM whether the event changes durable context.
6. Use heuristic fallback when no LLM is configured.
7. If significant, append an entry to a brain file.
8. Store a `brain_updates` row with rationale and commit metadata.

## Significance Criteria

Events are significant when they change or clarify:

- product goals
- architecture
- data model
- external integration requirements
- security assumptions
- launch constraints
- agent behavior
- open questions
- durable team decisions

Events are usually not significant when they are:

- casual acknowledgements
- status-only messages
- duplicate information
- implementation details already captured elsewhere

## Current Limitation

The first implementation mostly appends to `brain/decision_log.md`. A stronger future version should route updates to typed files like `architecture/*.md`, `goals/*.md`, and `context/open_questions.md`.
