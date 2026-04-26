---
id: decisions.ADR-0002-local-demo-fallbacks
type: decision
title: Keep Local Demo Fallbacks
status: accepted
importance: high
updated: 2026-04-25
links:
  - decisions.decision_log
  - architecture.runtime_flow
keywords:
  - local demo
  - fallback
  - hackathon
---

# ADR-0002: Keep Local Demo Fallbacks

## Decision

The product should work without a real database, OpenAI key, or GitHub brain repo.

## Context

Hackathon demos and early product exploration need a zero-setup experience. If the app requires every external service before showing value, testing becomes slow and fragile.

## Rationale

Local fallbacks let users test the full product loop immediately:

- ingest an event
- distill significance
- update a brain file
- search context
- edit Markdown

## Consequences

- In-memory mode is not durable.
- Production users must configure real env vars.
- Placeholder env values should be ignored instead of treated as real credentials.
