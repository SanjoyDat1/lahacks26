---
id: summaries.project_summary
type: summary
title: Project Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - index.md
  - map.md- brian.index
keywords:
  - summary
  - current state
  - quick context
---

# Project Summary

AI Brain is a full-stack product that keeps human project context synchronized with LLM coding agents.

It ingests engineering conversations and artifacts from various sources. Incoming events are normalized into one event shape, embedded for semantic search, and passed through a distiller that decides whether the event changes product goals, architecture, constraints, risks, or open questions.

If the event is significant, the app updates Markdown brain files. In production, those updates are committed for an audit trail. In local demo mode, the same flow works in memory so the product can be tested without credentials.

## What Works Right Now

- Full-stack application with various features and integrations.

## Agent Guidance

Before changing code, read this file, then read the specific architecture or decision files linked from the task.

## Source Evidence
- AI Brain is a full-stack product that keeps human project context synchronized with LLM coding agents.
- It ingests engineering conversations and artifacts from various sources.
- Updates are committed for an audit trail in production.
