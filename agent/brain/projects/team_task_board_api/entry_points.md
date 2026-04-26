---
id: entry_points
status: draft
importance: high
updated: 2026-04-26
links:
  - projects/team_task_board_api/overview.md
  - projects/team_task_board_api/testing.md
  - index.md
  - map.md
  - summaries/project_summary.md- projects/team_task_board_api/overview.md
  - projects/team_task_board_api/testing.md
keywords: [API, entry points, routes]
title: API Entry Points
---

## Purpose
Details on how to interact with the API

## Application Bootstrap
- To start the application, use the command: `uvicorn app.main:app --reload`

## API Routes
- `GET /health`: Health check endpoint.
- `GET /tasks`: Retrieve a list of tasks.
- `POST /tasks`: Create a new task.
- `PATCH /tasks/{task_id}`: Update an existing task's status or assignee.
- `GET /summary`: Retrieve summary metrics for the dashboard.
- `GET /bar`: Updated endpoint replacing /foo with new response schema.

## Source Evidence
- Application Bootstrap: uvicorn app.main:app --reload
- API Routes include GET /health and POST /tasks.