---
id: context.constraints
 type: context
 title: Project Constraints
 status: active
 importance: high
 updated: 2026-04-25
 links:
   - projects/iris_landing/overview.md
   - projects/iris_landing/open_questions.md
 keywords:
   - constraints
   - assumptions
   - limitations
links:
  - projects/iris_landing/overview.md
  - projects/iris_landing/open_questions.md
  - index.md
  - map.md
  - summaries/project_summary.md
---

# Project Constraints

This document outlines the technical and product constraints for the Iris Landing Page project.

## Technical Constraints
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

## Source Evidence
- The app must remain usable without external credentials for demos.
- The brain should stay human-readable Markdown.
