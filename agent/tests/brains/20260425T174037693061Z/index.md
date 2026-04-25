---
id: campuscompanion.index
type: index
title: Campus Companion Project Brain
status: active
importance: critical
updated: 2026-04-25
links:
  - summaries.project_summary
  - context.constraints
  - context.open_questions
  - decisions.decision_log
  - goals.product_goals
keywords:
  - source of truth
  - project memory
  - mobile app
  - student pilot
---

# Campus Companion Project Brain

This folder serves as the structured project brain for the Campus Companion mobile application. It is designed to be readable by humans, efficient for LLM lookup, and easy to render as a linked knowledge map.

Treat this file as the required entry point. Every generated working brain should include its own `index.md`, and every important generated file should be reachable from this page directly.

## Read Order For Agents

1.  Read [Project Summary](summaries/project_summary.md) for the shortest useful context.
2.  Read [Product Goals](goals/product_goals.md) to understand the product objectives for the pilot.
3.  Read [Constraints](context/constraints.md) before changing scope or implementing new features.
4.  Read [Decision Log](decisions/decision_log.md) before making design changes.
5.  Read [Open Questions](context/open_questions.md) for unresolved items and dependencies.

## Current Product State

Campus Companion is a mobile application developed for Northview High School students, currently in its first pilot release. The primary goal of the pilot is to help students quickly access essential daily school information: today's bell schedule, current announcements, and lunch information, thereby reducing the need to check multiple sources.

The application's home screen prioritizes today's schedule, announcements, and lunch information. Key features for the pilot include:
*   **Schedules:** Personalized class schedules with a fallback to the schoolwide bell schedule.
*   **Announcements:** School announcements sourced from the front office Google Sheet, with a strict requirement for office staff approval before publication.
*   **Lunch Menu:** Daily lunch information from the cafeteria vendor feed, with a user-friendly message displayed if the menu is not yet available.
*   **Club and Activity Calendar:** Available through bottom navigation.
*   **Notifications:** Limited to urgent announcements, schedule changes, and emergency alerts to avoid notification fatigue.

Data sources for the pilot include nightly SIS CSV exports for schedules, a front-office Google Sheet for announcements, a cafeteria vendor feed for lunch, and an activities calendar for clubs. Student authentication uses district Google accounts.

Important constraints for the first release include: no direct student-to-teacher messaging, no student comment threads, and no storage of sensitive data like grades or discipline records. Emergency alerts displayed in the app are mirrored from the official district emergency notification system and are not the primary source.

## Important Links

-   [Project Summary](summaries/project_summary.md)
-   [Product Goals](goals/product_goals.md)
-   [Decision Log](decisions/decision_log.md)
-   [Constraints](context/constraints.md)
-   [Open Questions](context/open_questions.md)
