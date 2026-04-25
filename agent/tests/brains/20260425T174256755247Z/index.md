---
id: campuscompanion.index
type: index
title: Campus Companion Project Brain
status: active
importance: critical
updated: 2026-04-25
links:
  - summaries.project_summary
  - goals.product_goals
  - decisions.decision_log
  - context.constraints
  - context.open_questions
keywords:
  - source of truth
  - project memory
  - student app context
---

# Campus Companion Project Brain

This folder is a structured project brain for the Campus Companion mobile application. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

Treat this file as the required entry point. Every generated working brain should include its own `index.md`, and every important generated file should be reachable from this page directly or through [Brain Map](map.md).

## Read Order For Agents

1.  Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2.  Read [Product Goals](goals/product_goals.md) and [Constraints](context/constraints.md) before changing scope.
3.  Read [Decision Log](decisions/decision_log.md) before making design changes.
4.  Read [Open Questions](context/open_questions.md) for current unknowns impacting the project.

## Current Product State

Campus Companion is a mobile application for Northview High School students, designed to simplify access to daily school information. The pilot release focuses on providing students with their daily schedule, school announcements, and lunch information without needing to check multiple sources.

Key features for the first release include:

-   **Schedule**: Personalized class schedule, with a fallback to the schoolwide bell schedule if a personal schedule is unavailable. The app highlights the current period and shows the next.
-   **Announcements**: School announcements pulled from a front-office Google Sheet, strictly limited to rows marked "approved" by office staff (Ms. Alvarez is the approval owner for the pilot).
-   **Lunch**: Daily lunch menu from the cafeteria vendor feed. If the menu is not available, the app displays "Menu not available yet" without blocking other features.
-   **Activities**: Club and activity calendar items available from the bottom navigation.
-   **Notifications**: Push notifications are reserved only for urgent announcements, schedule changes, and emergency alerts. Other updates, like club meetings or lunch menus, remain in the app feed.

Authentication uses district Google accounts. Privacy is a core focus, with the app storing only minimal profile information (name, school email, grade level, schedule identifiers) and explicitly avoiding grades, attendance, discipline, medical, or counseling data. Direct student-to-teacher messaging is not approved for the first release. Campus Companion displays approved emergency alerts but is not the official source of truth for emergency notifications.

## Important Links

-   [Brain Map](map.md)
-   [Project Summary](summaries/project_summary.md)
-   [Product Goals](goals/product_goals.md)
-   [Decision Log](decisions/decision_log.md)
-   [Constraints](context/constraints.md)
-   [Open Questions](context/open_questions.md)
