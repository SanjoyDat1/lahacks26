---
id: decisions.decision_log
type: decision_log
title: Decision Log
status: active
importance: critical
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md
  - goals/product_goals.md
  - context/constraints.md
  - context/open_questions.md
  - map.md
keywords:
  - decisions
  - rationale
  - product
  - architecture
  - scope
---

# Decision Log

This file lists durable product and architecture decisions for the Campus Companion project.

## Active Decisions

| ID | Decision | Status | Link |
| --- | --- | --- | --- |
| DEC-001 | First Release Scope: Centered on schedule, announcements, lunch, and club calendar. | Accepted | |
| DEC-002 | Schedule Fallback: App falls back to schoolwide bell schedule if personal schedule is unavailable. | Accepted | |
| DEC-003 | Announcement Approval: All announcements require front-office approval before publication. | Accepted | |
| DEC-004 | Limited Push Notifications: Only for urgent announcements, schedule changes, and emergency alerts. | Accepted | |
| DEC-005 | Authentication: Use district Google accounts for student login. | Accepted | |
| DEC-006 | Missing Lunch Data: Display "Menu not available yet" without blocking app use if data is missing. | Accepted | |
| DEC-007 | No Direct Messaging: Direct student-to-teacher messaging is excluded from Release One. | Accepted | |
| DEC-008 | Data Privacy: Do not store grades, attendance, discipline, medical, or counseling data. | Accepted | |
| DEC-009 | Emergency Alerts: Mirror approved alerts from the district system; Campus Companion is not the source. | Accepted | |
| DEC-010 | Minimum Profile Data: Store only name, school email, grade level, and schedule identifiers. | Accepted | |

## Decision Rules

- Do not delete old decisions.
- If a decision changes, write a new ADR that supersedes the previous one.
- Link decisions to impacted architecture files.
- Keep decisions short enough that agents can scan them quickly.
