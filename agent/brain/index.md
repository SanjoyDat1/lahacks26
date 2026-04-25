---
id: hackathon.index
type: index
title: Hackathon Team Memory Project Brain
status: active
importance: critical
updated: 2026-04-25
links:
  - summaries.project_summary
  - context.open_questions
keywords:
  - source of truth
  - project memory
  - coding agent context
  - hackathon
  - team memory
---

# Hackathon Team Memory Project Brain

This folder is a structured project brain for the AI-assisted team memory tool. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

Treat this file as the required entry point. Every generated working brain should include its own `index.md`, and every important generated file should be reachable from this page directly or through a clearly linked navigation file.

## Read Order For Agents

1. Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2. Read [Open Questions](context/open_questions.md) to understand unresolved design or product questions.

## Current Product State

The Hackathon Team Memory project is building an AI-assisted team memory tool. It features a Python CLI that orchestrates three main flows:

-   **Bootstrap:** Creates the initial working `brain/` folder from a user prompt and optional source files.
-   **Query:** Uses a reader agent to answer questions from the working brain, falling back to the reference `brian/` example only for structure guidance.
-   **Update:** Uses a writer agent to modify existing working brain files while preserving valid YAML frontmatter.

The project utilizes OpenAI as its LLM provider for selection, generation, query, and update flows. OpenAI reasoning summaries should be printed when available to aid developer debugging. The reference `brian/` folder is read-only and acts as a schema, style guide, and example knowledge map, while the working `brain/` folder is created lazily from source context.

Core product goals include preserving useful project knowledge, distilling only durable context (goals, constraints, architecture, decisions, unresolved questions, implementation notes), avoiding low-signal notes, making `index.md` the required starting point, ensuring all generated files are linked, and supporting a local demo workflow without external infrastructure.

## Important Links

-   [Project Summary](summaries/project_summary.md)
-   [Open Questions](context/open_questions.md)
