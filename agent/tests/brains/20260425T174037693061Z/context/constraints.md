---
id: context.constraints
type: context
title: Constraints
status: active
importance: high
updated: 2026-04-25
links:
  - context/open_questions.md
  - decisions/decision_log.md
  - goals/product_goals.md
keywords:
  - constraints
  - limitations
  - scope
  - privacy
  - data sources
  - notifications
---

# Constraints

## Application Constraints (Campus Companion)

### Technical Constraints

-   Schedule data must come from a nightly SIS CSV export, including period name, start time, end time, room, teacher, and schedule type (regular, advisory, late-start, assembly).
-   Announcements must be pulled from the front-office Google Sheet. Only rows explicitly marked "approved" by office staff are to be synced and displayed. Draft rows must never appear.
-   Lunch menu data is sourced from the cafeteria vendor feed or weekly PDFs.
-   Club and activity calendar items are sourced from the activities calendar.
-   Student authentication must use district Google accounts. A launch dependency exists regarding ninth graders who have not yet accepted district account terms.
-   If a student's personal schedule is not loaded, the app must fall back to displaying the schoolwide bell schedule. This is expected behavior, not an error.
-   If the lunch menu is unavailable (e.g., vendor feed is late), the app must display "Menu not available yet" and remain fully functional for other features.

### Product & Scope Constraints

-   The initial pilot release must focus on practical school-day information: today's schedule, current announcements, and lunch information, making the daily routine easier for students.
-   The home screen must be centered on three core elements: today's schedule, announcements, and lunch. The initial card order is schedule, announcements, then lunch.
-   Direct student-to-teacher messaging is explicitly not approved for the first release.
-   Student comment threads on announcements are not approved for the first release.
-   The app must not display or store gradebook, attendance, discipline, medical notes, or counseling information.
-   Emergency alerts displayed in the app must be mirrored from the district emergency notification system and not described as replacing the official district system. Content for these alerts must be phrased carefully and approved.
-   Push notifications are strictly limited to urgent announcements, schedule changes, and emergency alerts. Notifications for club meetings or general lunch menu updates are not permitted in the first release.
-   The app must support accessibility features like dynamic text size and VoiceOver, and use color redundantly for urgent items.

### Privacy Constraints

-   The app must not store grades, attendance, discipline records, medical notes, or private counseling data.
-   Only the minimum profile information required for the pilot (name, school email, grade level, and schedule identifiers) should be stored.

## Knowledge Base Constraints (for this brain)

-   The brain content must remain human-readable Markdown.
-   Brain files must be understandable by both humans and LLMs.
-   Files should not become noisy dumps of raw transcripts or chat logs; content should be curated and summarized.
-   Significant updates to brain files must explain their source and rationale.
-   Important files should be graph-linked to prevent them from being orphaned within the knowledge base.
-   When retrieved by agents, summaries should be read before long files to optimize context usage.
-   Frontmatter should contain machine-usable metadata.
-   Body content should prioritize meaning and clarity over rigid adherence to a template.
-   Boilerplate text should be minimized to conserve retrieval and context-window budget.
## Updates

- 2026-04-25: Counseling must send activation instructions before the Campus Companion pilot. ([meeting](https://meetings.example.test/platform-sync))
