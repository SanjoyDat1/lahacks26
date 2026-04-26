---
id: brian.map
type: map
title: Brain Map
status: active
importance: high
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md- brian.index
  - summaries.project_summary
keywords:
  - graph
  - map
  - backlinks
---

# Brain Map

This file is the visual navigation layer for the brain. Humans can use it to understand the project shape. Agents can use it to decide which files to read next.

```mermaid
flowchart LR
  Index["index.md"] --> ProjectSummary["summaries/project_summary.md"]
```

## Map Rules

- Every important file should be reachable from `index.md` or this map.
