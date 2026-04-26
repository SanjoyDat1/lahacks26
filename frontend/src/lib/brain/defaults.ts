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
    content: `# Project overview

Add a short, factual summary of **your** project—the one from your repos, uploads, and connected imports (name, purpose, who it is for).

## Mission

*(Replace with goals stated in your sources.)*
`,
  },
  {
    path: "brain/architecture.md",
    content: `# Architecture

## System shape

*(Replace with how **your** codebase or product is structured—only what your sources support.)*
`,
  },
  {
    path: "brain/goals.md",
    content: `# Goals

- *(List objectives that appear in your project sources.)*
`,
  },
  {
    path: "brain/decision_log.md",
    content: `# Decision log

Record durable decisions grounded in **your** project. Cite the source (doc, PR, sheet, etc.) when possible.
`,
  },
  {
    path: "brain/open_questions.md",
    content: `# Open questions

- *(Track ambiguities or gaps from your imports—not generic product questions.)*
`,
  },
  {
    path: "brain/agent_system_prompt.md",
    content: `# Coding agent system prompt

Before writing code, read the Markdown under this brain folder so behavior matches **this** project's documented context.

Document durable design decisions in \`brain/decision_log.md\` when your sources require it.
`,
  },
];
