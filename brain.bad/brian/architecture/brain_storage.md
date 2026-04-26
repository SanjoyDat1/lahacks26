---
id: architecture.brain_storage
type: architecture
title: Brain Storage
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.system_overview
  - architecture.distillation_pipeline
  - decisions.decision_log
keywords:
  - GitHub
  - Markdown
  - audit trail
  - brain files
---

# Brain Storage

The brain is a set of Markdown files that humans and coding agents can read.

## Production Storage

Production uses GitHub as the source of truth.

Required env vars:

- `GITHUB_TOKEN`
- `BRAIN_REPO_OWNER`
- `BRAIN_REPO_NAME`
- `BRAIN_REPO_BRANCH`

When these are set, brain reads and writes go through the GitHub Contents API. Human edits and AI distillation updates become commits.

## Local Demo Storage

If GitHub env vars are not configured, the app uses an in-memory brain seeded from defaults in `src/lib/brain/defaults.ts`.

This is useful for local testing but resets when the server restarts.

## Recommended Future Brain Shape

The current runtime brain is flat. This example `brian/` folder proposes a graph-shaped brain:

- strict frontmatter
- flexible typed body sections
- summaries for fast lookup
- map file for visualization
- backlinks for traversal

## Agent Rule

Agents should never create orphan brain files. Every new file should be linked from at least one existing file, and important files should be linked from `index.md` or `map.md`.
