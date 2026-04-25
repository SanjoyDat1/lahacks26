---
id: decisions.ADR-0001-git-backed-brain
type: decision
title: Use GitHub-Backed Markdown As The Production Brain
status: accepted
importance: critical
updated: 2026-04-25
links:
  - decisions.decision_log
  - architecture.brain_storage
keywords:
  - GitHub
  - Markdown
  - audit trail
---

# ADR-0001: Use GitHub-Backed Markdown As The Production Brain

## Decision

Use Markdown files in a GitHub repository as the production source of truth for project brain content.

## Context

The system needs a source of truth that humans can inspect, agents can read, and teams can audit over time.

## Rationale

Git provides:

- history
- diffs
- blame
- branches
- review workflows
- durable human-readable artifacts

Markdown provides:

- readable prose
- diagrams
- links
- compatibility with Obsidian-style workflows
- low friction for humans and LLMs

## Consequences

- Brain updates should have clear commit messages.
- Agents should document durable design choices before implementation.
- The app needs a local fallback for demos without GitHub credentials.
