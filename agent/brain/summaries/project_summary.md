---
id: summaries.project_summary
type: summary
title: Project Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - index.md
  - map.md- brain.index
  - architecture.system_overview
keywords:
  - summary
  - current state
  - quick context
---

# Project Summary

AI Brain is a full-stack product that keeps human project context synchronized with LLM coding agents.

It ingests engineering conversations and artifacts from GitHub, GitLab, Slack, Discord, and meeting transcripts. Incoming events are normalized into one event shape, embedded for semantic search, and passed through a distiller that decides whether the event changes product goals, architecture, constraints, risks, or open questions.

If the event is significant, the app updates Markdown brain files. In production, those updates are committed to GitHub for an audit trail. In local demo mode, the same flow works in memory so the product can be tested without credentials.

## What Works Right Now

- Next.js app with dashboard, brain editor, events page, integrations page, and semantic search page.
- API endpoints for GitHub, GitLab, Slack, Discord, meetings, brain files, search, integrations, and demo seeding.
- Drizzle schema for Postgres tables.
- pgvector-compatible document embeddings.
- OpenAI-backed embeddings and JSON distillation when `OPENAI_API_KEY` is present.
- Deterministic fallback embeddings and heuristic distillation when no API key is present.
- GitHub-backed brain file read/write/commit when GitHub env vars are configured.
- In-memory fallback brain and event store for local testing.

## Fastest Local Test

Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`, click `Seed demo events`, then inspect:

- `/brain`
- `/events`
- `/search`
- `/integrations`

## Agent Guidance

Before changing code, read this file, then read the specific architecture or decision files linked from the task.
