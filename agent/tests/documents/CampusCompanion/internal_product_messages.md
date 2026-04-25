---
source: internal_messages
channel: campus-companion-product
timestamp: 2026-03-12T15:20:00-07:00
---

# Internal Messages: Product Development Notes

Mina 3:20 PM: For the student pilot, please keep the home screen centered on three things: today's schedule, announcements, and lunch. We can add more tiles later, but the first release should make the daily routine easier.

Priya 3:23 PM: The home screen currently orders cards as schedule first, announcements second, lunch third. The club calendar is available from the bottom navigation but not featured above the fold.

Jordan 3:27 PM: Data source summary for the knowledge base: schedules come from the nightly SIS CSV, announcements come from the front-office Google Sheet, lunch comes from the cafeteria vendor feed when available, and club events come from the activities calendar.

Ethan 3:31 PM: Privacy note: we are not storing grades, discipline records, medical notes, or private counseling data. The app only needs name, school email, grade level, and schedule identifiers for the pilot.

Mina 3:34 PM: Decision: no direct messaging between students and teachers in the first release. Students asked for it, but faculty want us to prove the schedule and announcement workflow before adding communications.

Priya 3:38 PM: Accessibility status: schedule cards support dynamic text size, the announcement list reads cleanly with VoiceOver, and color is not the only way we mark urgent items.

Jordan 3:42 PM: Open question: do we show bus route reminders in the first release? Transportation has data, but they have not confirmed whether route changes can be published to students through this app.

Ethan 3:48 PM: Another constraint: emergency alerts must still come from the district emergency notification system. Campus Companion can mirror the alert after it is approved, but it is not the source of truth for emergencies.

Mina 3:55 PM: Capturing the durable points: first release scope is schedule, announcements, lunch, and club calendar; notification categories are urgent announcement, schedule change, and emergency alert; no teacher messaging in release one.
