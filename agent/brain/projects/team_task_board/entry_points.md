---
id: entry_points
 type: document
 title: API Entry Points
 status: draft
 importance: high
 updated: 2026-04-25
 links:
   - projects/team_task_board/overview.md
   - projects/team_task_board/data_model.md
keywords: [API, entry points, routes]
links:
  - projects/team_task_board/overview.md
  - projects/team_task_board/data_model.md
  - index.md
  - map.md
  - summaries/project_summary.md
---

# API Entry Points

## List of API routes

The following API routes are available in the Team Task Board API:
- `GET /health`: Health check endpoint to verify the service is running.
- `GET /tasks`: Retrieve a list of tasks.
- `POST /tasks`: Create a new task.
- `PATCH /tasks/{task_id}`: Update an existing task's status or assignee.
- `GET /summary`: Get a summary of tasks for dashboard metrics.

## Source Evidence
- Application Bootstrap: uvicorn app.main:app --reload
- API Routes: GET /health, GET /tasks, POST /tasks, PATCH /tasks/{task_id}, GET /summary
