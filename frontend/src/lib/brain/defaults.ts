import type { BrainFile } from "@/lib/types";

export const brainPaths = [
  "brain/project_overview.md",
  "brain/architecture.md",
  "brain/goals.md",
  "brain/decision_log.md",
  "brain/open_questions.md",
  "brain/agent_system_prompt.md",
];

export const defaultBrainFiles: BrainFile[] = [
  {
    path: "brain/project_overview.md",
    content: `# Project Overview

AI Brain is a source-of-truth layer that turns asynchronous product and engineering communication into structured project context.

## Mission

Bridge the gap between human decisions and LLM execution by keeping project goals, architecture, and decision history current in a Git-backed brain.
`,
  },
  {
    path: "brain/architecture.md",
    content: `# Architecture

## Pipeline

1. Ingest events from GitHub, GitLab, Slack, Discord, and meeting transcripts.
2. Store normalized raw events and vector-searchable documents.
3. Distill significant changes into brain updates.
4. Commit source-of-truth changes to GitHub.
5. Give coding agents a system prompt that requires reading the brain before implementation.
`,
  },
  {
    path: "brain/goals.md",
    content: `# Goals

- Preserve project intent across meetings, pull requests, issues, and chat.
- Make AI-generated understanding auditable through Git commits.
- Give humans a fast editor for correcting and improving the brain.
- Give coding agents an explicit, current context source before writing code.
`,
  },
  {
    path: "brain/decision_log.md",
    content: `# Decision Log

Record durable product and architecture decisions here. Each entry should include the source event, rationale, and impact.
`,
  },
  {
    path: "brain/open_questions.md",
    content: `# Open Questions

- Which source channels should be treated as authoritative for goals?
- What review policy should be required before AI brain updates are committed?
`,
  },
  {
    path: "brain/agent_system_prompt.md",
    content: `# Coding Agent System Prompt

Before writing code, read every file under /brain to understand the current project context.

If you make a durable design or product decision, document it in /brain/decision_log.md before implementing the code.

If requirements conflict, prefer the most recent committed brain context and explain the conflict to the human.
`,
  },
];
