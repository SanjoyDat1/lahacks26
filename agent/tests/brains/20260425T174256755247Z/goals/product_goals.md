---
id: goals.product_goals
type: goals
title: Product Goals
status: active
importance: high
updated: 2026-04-25
links:
  - summaries.project_summary
  - decisions.decision_log
  - context.constraints
  - context.open_questions
keywords:
  - goals
  - product
  - launch
---

# Product Goals

## Primary Goal

Help Northview High School students quickly access essential daily school information (schedule, announcements, lunch) from a single mobile app, reducing the need to check multiple sources.

## User-Facing Goals

- Students should be able to open the app and see today's bell schedule, current announcements, and lunch information without checking three different places.
- Display personalized class schedules, with current periods highlighted, and fall back to the schoolwide bell schedule when personal data is unavailable.
- Clearly label the type of bell schedule currently active (e.g., regular, advisory, late-start, assembly).
- Show school announcements grouped by date, with urgent items pinned at the top.
- Provide the lunch menu directly from the home screen.
- Allow students to search the club and activity calendar.
- Limit push notifications to urgent announcements, schedule changes, and emergency alerts, avoiding excessive alerts.
- Present a friendly message when the lunch menu is not yet available, without blocking other app functionality.

## Launch Goals

- Successfully authenticate students using their district Google accounts.
- Import student schedule data from nightly SIS CSV exports.
- Sync school announcements from the front-office Google Sheet, publishing only rows marked "approved" by office staff.
- Integrate the cafeteria vendor feed for lunch menus, displaying "Menu not available yet" if data is missing.
- Include club and activity calendar items from the student activities calendar.
- Ensure the home screen presents schedule first, announcements second, and lunch third.
- Support a clear path for students, especially ninth graders, to activate district Google accounts for login.

## Non-Goals For The First Version

- Direct student-to-teacher messaging.
- Student comment threads on announcements.
- Displaying or storing grades, attendance, discipline records, medical notes, or counseling information.
- Sports game scores.
- Homework display.
