---
id: summaries.project_summary
type: summary
title: Project Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - index.md
  - goals/product_goals.md
  - decisions/decision_log.md
  - context/constraints.md
  - context/open_questions.md
keywords:
  - summary
  - current state
  - quick context
  - CampusCompanion
  - mobile app
  - pilot
---

# Project Summary

Campus Companion is a mobile application designed for Northview High School students. The primary goal for its pilot release is to simplify access to essential daily school information, enabling students to quickly view their bell schedule, current announcements, and lunch details without navigating multiple sources. The app aims to make the daily routine easier by centralizing key information.

## Key Pilot Features and Status

- **Core Information Display:** The home screen is centered on today's schedule, announcements, and lunch information.
- **Schedule Management:** Displays personalized class schedules, with an automatic fallback to the schoolwide bell schedule if a student's personal schedule is unavailable. The schedule card highlights the current period and shows the next.
- **Announcements:** Publishes school announcements pulled from a front-office Google Sheet, strictly limited to rows explicitly marked "approved" by office staff (Ms. Alvarez for the pilot).
- **Lunch Menu:** Shows the daily lunch menu from the cafeteria vendor feed. If the menu data is unavailable or late, it displays "Menu not available yet" without disrupting other app functionality.
- **Club & Activities Calendar:** Includes a calendar for club and activity events.
- **Notifications:** Push notifications are restricted to urgent announcements, schedule changes, and emergency alerts to avoid notification fatigue.
- **Data Integrations:** Connects to the Student Information System (SIS) for schedule data (nightly CSV), the front-office Google Sheet for announcements, the cafeteria vendor feed for lunch, and an activities calendar for club events.
- **Authentication:** Utilizes district Google accounts for student login.
- **Accessibility:** Schedule cards support dynamic text size, the announcement list is compatible with VoiceOver, and urgent items are marked using methods beyond just color.

## Key Pilot Readiness & Considerations

- **Student Account Activation:** Student login via district Google accounts is a launch dependency. Counseling is preparing reminder instructions, especially for ninth graders who may not have accepted district account terms.
- **Announcement Approval Workflow:** All announcements must be approved by front-office staff before appearing in the app. Club advisors can submit items, but office approval is mandatory.
- **Emergency Alert Protocol:** Campus Companion displays approved emergency alerts mirrored from the district emergency notification system. It is explicitly not the official source of truth for emergencies.
- **Privacy Constraints:** The app does not store grades, attendance, discipline, medical, or private counseling information. Only minimal profile data (name, school email, grade level, schedule identifiers) is collected for the pilot.
- **No Direct Messaging:** Direct student-to-teacher messaging is explicitly excluded from the first release.

## Agent Guidance

Before making changes or addressing tasks related to Campus Companion, please read this project summary for a high-level overview. Then, consult the specific goals, decisions, constraints, or open questions files linked from the task for detailed context.
