---
id: data_model
 type: document
 title: Data Model
 status: draft
 importance: high
 updated: 2026-04-25
 links:
   - projects/team_task_board/overview.md
   - projects/team_task_board/entry_points.md
keywords: [data model, task, API]
links:
  - projects/team_task_board/overview.md
  - projects/team_task_board/entry_points.md
  - index.md
  - map.md
  - summaries/project_summary.md
---

# Data Model

## Description of data structures

The primary data structure used in the Team Task Board API is the `Task` model, which includes the following fields:
- `id`: Unique identifier for the task.
- `title`: Title of the task.
- `description`: Detailed description of the task.
- `assignee`: User assigned to the task.
- `priority`: Priority level of the task.
- `status`: Current status of the task.

## Source Evidence
- Task: Represents a task with fields like id, title, description, assignee, priority, and status.
