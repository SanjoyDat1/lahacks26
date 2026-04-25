---
id: context.constraints
type: context
title: Constraints
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.system_overview
  - decisions.decision_log
keywords:
  - constraints
  - assumptions
  - limitations
---

# Constraints

## Technical Constraints

- The app is a Next.js TypeScript application.
- Vercel is the primary deployment target.
- Postgres with pgvector is the intended production database.
- The app must remain usable without external credentials for demos.
- The brain should stay human-readable Markdown.

## Product Constraints

- The brain must be understandable by humans and LLMs.
- Brain files should not become noisy dumps of raw transcripts or chat logs.
- Significant updates should explain their source and rationale.
- Important files should be graph-linked so they are not orphaned.

## Retrieval Constraints

- Agents should read summaries before long files.
- Frontmatter should contain machine-usable metadata.
- Body content should prioritize meaning over template rigidity.
- Boilerplate should be minimized because it wastes retrieval and context-window budget.
