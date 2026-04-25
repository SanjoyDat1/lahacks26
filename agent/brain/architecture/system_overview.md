---
id: architecture.system_overview
type: architecture
title: System Overview
status: active
importance: critical
updated: 2026-04-25
links:
  - architecture.runtime_flow
keywords:
  - system design
  - FastAPI
  - React
  - task management
---

# System Overview

The Team Task Board is a context management system designed to facilitate task management for teams.

## System Role

The application serves to manage tasks through a structured API and user interface, allowing for efficient task creation and status updates.

## Main Components
- **Backend**: FastAPI application that handles API requests and task management logic.
- **Frontend**: React application that interacts with the backend API to display tasks and allow user interactions.

## Current Runtime Modes
### Development Mode
- The application runs locally with in-memory data storage.
- Easy to set up and test without external dependencies.

### Production Mode
- Not explicitly defined in the source, but can be assumed to involve persistent storage and deployment considerations.

## Related Files
- [Runtime Flow](runtime_flow.md)
- [Decision Log](../decisions/decision_log.md)
