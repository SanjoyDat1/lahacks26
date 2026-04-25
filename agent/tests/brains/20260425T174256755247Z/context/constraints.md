---
id: context.constraints
type: context
title: Constraints
status: active
importance: high
updated: 2026-04-25
links:
  - decisions/decision_log.md
  - context/open_questions.md
  - goals/product_goals.md
keywords:
  - constraints
  - scope
  - data sources
  - privacy
  - reliability
---

# Constraints

## Product Scope & Features

*   The initial pilot release scope is limited to displaying a personalized class schedule (with a schoolwide fallback), front-office approved announcements, lunch menu information, and club/activity calendar items.
*   The home screen must be centered on today's schedule, announcements, and lunch information.
*   Push notifications are strictly limited to urgent announcements, schedule changes, and emergency alerts. General club meetings or lunch menu updates will not trigger notifications.
*   Direct student-to-teacher messaging is explicitly not approved for the first release.
*   Student comment threads on announcements are not approved for the first release.
*   The app will not include or store gradebook, attendance, discipline, or counseling information.
*   The app must avoid features that would create new moderation work for faculty in the first release.

## Data & Integration

*   Student schedule data is sourced from a nightly Student Information System (SIS) CSV export.
*   Announcement data is pulled from the front-office Google Sheet, and only rows explicitly marked "approved" by office staff will sync into the app.
*   Lunch menu data is sourced from the cafeteria vendor feed or weekly PDF.
*   Club and activity calendar data is sourced from the activities calendar maintained by student activities.
*   Student authentication uses district Google accounts.
*   Emergency alerts must originate from the district emergency notification system. Campus Companion will only display *approved* alerts and is not the official source of truth for emergencies. App copy must reflect that alerts are mirrored from the district system.

## Privacy & Security

*   The app must not store grades, attendance, discipline records, medical notes, or private counseling data.
*   Only the minimum profile information required for the pilot will be stored: student name, school email, grade level, and schedule identifiers.

## User Experience & Reliability

*   The app must remain usable and display a friendly message (e.g., "Menu not available yet") if the lunch menu data is missing or late. Missing lunch data must not block other app features.
*   The schedule card must remain useful (e.g., by falling back to the schoolwide bell schedule) even if a student's personal schedule has not yet loaded.
*   Student Google account activation is a launch dependency, and clear instructions must be provided to students (especially ninth graders) before the app's launch.

## Operational & Process

*   Ms. Dana Alvarez (Assistant Principal) is the designated approval owner for schoolwide announcements during the spring pilot.
*   A front office approval workflow is required for all announcements to appear in the app.
## Updates

- 2026-04-25: Counseling must send activation instructions before the Campus Companion pilot. ([meeting](https://meetings.example.test/platform-sync))
