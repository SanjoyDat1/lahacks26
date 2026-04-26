---
id: projects.team_task_board.overview
type: overview
title: Project Overview
status: active
importance: high
updated: 2026-04-25
links:
  - projects/team_task_board/data_flow.md
  - projects/team_task_board/setup.md
  - projects/team_task_board/open_questions.md
  - index.md
  - map.md
  - summaries/project_summary.md- projects/team_task_board/data_flow.md
  - projects/team_task_board/setup.md
  - projects/team_task_board/open_questions.md
keywords:
  - project overview
  - task management
  - frontend
---

# Project Overview

The Team Task Board Web is a lightweight frontend for the Team Task Board app that allows users to create tasks and manage their statuses.

## User Capabilities
- Fetches task data from the backend API.
- Displays tasks grouped by their status.
- Allows users to create new tasks.
- Enables users to move tasks through different workflow statuses.
- Handles loading and error states.

## Technical Stack
- **Frontend Framework**: React 18
- **Build Tool**: Vite
- **Styling**: Plain CSS

## Entry Points
- **Application Bootstrap**: `src/main.jsx`
- **API Routes**: Expects various endpoints from the backend.

## Source Evidence
- The frontend communicates with the backend API to fetch and manipulate task data.
