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
  - context/constraints.md
  - context/open_questions.md
  - goals/product_goals.md
  - decisions/decision_log.md
keywords:
  - decisions
  - rationale
  - pilot scope
  - data handling
  - notifications
---

# Decision Log

This file lists durable product and architecture decisions for the Campus Companion project. Detailed decisions should live in ADR files.

## Active Decisions

| ID | Decision | Status |
| --- | --- | --- |
| D-001 | **Core Pilot Scope:** The first release of Campus Companion will focus on displaying today's schedule, current announcements, lunch information, and the club/activity calendar. | Accepted |
| D-002 | **Excluded Release-One Features:** Direct student-to-teacher messaging, student comment threads, gradebook, attendance, discipline, and counseling information are excluded from the first release. | Accepted |
| D-003 | **Schedule Data Fallback:** If a student's personalized schedule is unavailable, the app will display the schoolwide bell schedule as expected behavior. | Accepted |
| D-004 | **Announcement Approval Workflow:** Only announcements explicitly marked "approved" by front office staff (Ms. Alvarez for the pilot) will be published in the app. | Accepted |
| D-005 | **Missing Lunch Menu Handling:** If the lunch menu feed is unavailable, the app will display "Menu not available yet" without blocking other app functionality. | Accepted |
| D-006 | **Notification Policy:** Push notifications are strictly limited to urgent announcements, schedule changes, and emergency alerts to prevent notification fatigue. | Accepted |
| D-007 | **Emergency Alert Role:** Campus Companion will display approved emergency alerts mirrored from the district emergency notification system, but it is not the official source of truth for emergencies. | Accepted |
| D-008 | **Data Privacy Principles:** The app will only store minimal student profile information (name, school email, grade level, schedule identifiers) and will not store grades, attendance, discipline, medical notes, or private counseling data. | Accepted |
| D-009 | **Authentication Method:** Student authentication for Campus Companion will utilize existing district Google accounts. | Accepted |

## Decision Rules

- Do not delete old decisions.
- If a decision changes, write a new ADR that supersedes the previous one.
- Link decisions to impacted architecture files.
- Keep decisions short enough that agents can scan them quickly.
