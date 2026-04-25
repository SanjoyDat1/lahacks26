---
id: summaries.project_summary
type: summary
title: Project Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md
  - goals/product_goals.md
  - decisions/decision_log.md
  - context/constraints.md
  - context/open_questions.md
  - map.md
keywords:
  - summary
  - current state
  - quick context
  - CampusCompanion
  - mobile app
  - pilot
  - Northview High School
---

# Project Summary

Campus Companion is a mobile application designed for Northview High School students. Its primary goal for the initial pilot is to simplify access to essential daily school information, allowing students to quickly find today's bell schedule, current announcements, and lunch details without consulting multiple sources.

The pilot focuses on providing practical, school-day information and avoiding features that would create new moderation work for faculty. It is being piloted at Northview High School, with a clear scope for its first release.

## Pilot Scope & Current State

The Campus Companion pilot release focuses on the following features and capabilities:

*   **Personalized Class Schedule:** Students can view their personal class schedule. If a personal schedule is unavailable, the app defaults to the schoolwide bell schedule, highlighting the current period and showing the next. Supports various schedule types (regular, advisory, late-start, assembly).
*   **School Announcements:** Displays announcements pulled from the front-office Google Sheet, strictly limited to rows marked "approved" by office staff (Ms. Alvarez is the approval owner for the pilot). Urgent items are pinned.
*   **Lunch Menu:** Shows the daily lunch menu from the cafeteria vendor feed. If the menu is not yet available, a "Menu not available yet" message is displayed without blocking other app functionality.
*   **Club and Activity Calendar:** Provides access to club and activity events, available via bottom navigation.
*   **Limited Push Notifications:** Notifications are reserved for urgent announcements, schedule changes, and emergency alerts only. General club meetings or lunch updates do not trigger notifications.
*   **Home Screen Layout:** The main home screen prominently features today's schedule, announcements, and lunch information.
*   **Accessibility:** Schedule cards support dynamic text size, the announcement list reads cleanly with VoiceOver, and urgent items are marked without relying solely on color.

## Key Pilot Dependencies & Known Edge Cases

*   **Student Google Account Activation:** Authentication uses district Google accounts. Ninth graders who haven't accepted district account terms may face initial sign-in issues. Counseling needs to provide reminder instructions and a launch plan.
*   **Late Lunch Menu PDFs:** The cafeteria vendor sometimes publishes weekly PDFs late. The app handles this gracefully by displaying "Menu not available yet" and allowing other features to function.

## Pilot Guiding Principles & Constraints

Before implementing changes or expanding features, review these core principles and constraints for the Campus Companion pilot:

*   **Release-One Scope:** Adhere strictly to the approved features: personalized/schoolwide schedule, office-approved announcements, lunch menu, club/activity calendar, and limited push notifications. Features like direct student-to-teacher messaging, student comment threads, gradebook, attendance, discipline, or counseling information are explicitly excluded from this release.
*   **Data Privacy:** The app will only store minimal profile information (name, school email, grade level, schedule identifiers) and will NOT store grades, attendance, discipline records, medical notes, or private counseling data.
*   **Emergency Alerts:** Campus Companion may display *approved* emergency alerts, but it is not the official source of truth for emergencies. The district emergency notification system remains the authoritative source, and app copy should reflect this.
*   **Notification Strategy:** Prioritize user experience by limiting push notifications to urgent announcements, schedule changes, and emergency alerts. Avoid excessive notifications for routine updates.
*   **Faculty Approval for Announcements:** All announcements must be marked "approved" by front office staff before appearing in the app.
*   **No Direct Messaging:** Direct student-to-teacher messaging is not permitted in the first release.

## Open Questions

*   **Bus Route Reminders:** Transportation has not yet confirmed if bus route reminders can be published to students through Campus Companion.
*   **Optional Club Notifications:** Student activities needs to decide if students can opt-in to follow individual clubs for optional notifications after the pilot phase.
