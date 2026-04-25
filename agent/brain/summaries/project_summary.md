---
id: summaries.project_summary
type: summary
title: Project Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - brian.index
  - architecture.system_overview
  - decisions.decision_log
keywords:
  - summary
  - current state
  - quick context
---

# Project Summary

The Team Task Board is a full-stack application that provides a simple in-memory REST API for task management, allowing users to create tasks and manage their statuses through a web interface.

## Key Features
- FastAPI backend for handling API requests.
- React frontend for user interaction.
- API endpoints for health checks, task listing, task creation, and updates.

## Current State
- The backend is built with Python 3.11+ and FastAPI, while the frontend uses React 18 and Vite.
- The application is capable of running in development mode with minimal setup.

## Fastest Local Test

To run the application locally:
1. For the backend, create a virtual environment, install dependencies, and run:
   ```bash
   uvicorn app.main:app --reload
   ```
2. For the frontend, run:
   ```bash
   npm install
   npm run dev
   ```

## Agent Guidance

Before changing code, read this file, then read the specific architecture or decision files linked from the task.
