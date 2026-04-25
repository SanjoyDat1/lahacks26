---
id: summaries.project_summary
type: summary
title: Project Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - index
  - summaries.project_summary
  - context.open_questions
keywords:
  - summary
  - current state
  - quick context
---

# Project Summary

Hackathon Team Memory is a tool designed to build a lightweight project brain that preserves durable engineering context for fast-moving teams. Its purpose is to help coding agents and human teammates quickly understand the project, its motivations, established decisions, current uncertainties, and essential files before making changes.

The core goal is to distill and preserve only durable context—goals, constraints, architecture, decisions, unresolved questions, and key implementation notes—without requiring manual document maintenance or storing low-signal information like every chat message or transient idea. The system ensures `index.md` is the mandatory entry point and navigation hub for both humans and agents, with all other generated brain files linked either directly or via clearly linked navigation files. A local demo workflow is supported to function without external infrastructure.

## What Works Right Now

*   A Python CLI provides three main flows: `bootstrap`, `query`, and `update`.
*   The `bootstrap` command creates an initial working `brain/` folder from a user prompt and optional source files.
*   The `query` command uses a reader agent to answer questions based on the content of the working brain.
*   The `update` command uses a writer agent to modify existing working brain files while preserving their YAML frontmatter.
*   Gemini serves as the LLM provider for selection, generation, query, and update operations.
*   LLM "thinking summaries" are printed to the console to aid developers in debugging file selection or generation rationale.
*   The working `brain/` folder is created lazily, containing only the files selected for the current project.
*   `index.md` is always created as the critical navigation entry point and links to all other generated files.
*   The system can generate `summaries/project_summary.md` and `context/open_questions.md` when relevant context is provided.

## Fastest Local Test

Run the `bootstrap` command using the Python CLI (specific command varies by implementation).

```bash
# Example: (replace with actual command)
python cli.py bootstrap --prompt "Create a minimal brain for this hackathon project" --source-files sample_context.txt
```

Then, inspect the newly generated `brain/` folder, paying particular attention to:

*   `brain/index.md`
*   `brain/summaries/project_summary.md`
*   `brain/context/open_questions.md`

## Agent Guidance

Before changing code, read this file for a high-level overview. Then, consult `index` and `context.open_questions` for more specific details or unresolved items related to your task.
