---
source: rollout_notes
owner: campus-companion-team
date: 2026-03-14
---

# Campus Companion Pilot Rollout Notes

## Pilot Goal
Campus Companion is a mobile app for Northview High School students. The pilot should help students answer common school-day questions quickly: What class is next, which bell schedule is running, what announcements matter today, what is for lunch, and what activities are coming up?

## Release-One Scope
- Personalized class schedule, with a fallback to the schoolwide bell schedule when a student's personal schedule is unavailable.
- School announcements from the front-office Google Sheet, but only rows marked approved by office staff.
- Lunch menu from the cafeteria vendor feed. If the vendor feed or PDF is late, show "Menu not available yet" and keep other app features available.
- Club and activity calendar from the activities calendar.
- Push notifications only for urgent announcements, schedule changes, and emergency alerts.

## Data Sources
- Student schedule data: nightly SIS CSV export.
- Announcement data: front-office Google Sheet with an approval flag.
- Lunch data: cafeteria vendor feed or weekly PDF.
- Club and activity data: activities calendar maintained by student activities.
- Authentication: district Google accounts.

## Privacy And Safety Constraints
- Do not store grades, attendance, discipline records, medical notes, or counseling information.
- Store only the minimum profile information needed for the pilot: name, school email, grade level, and schedule identifiers.
- Do not launch direct student-to-teacher messaging in release one.
- Emergency alerts remain owned by the district emergency notification system. Campus Companion can display approved alerts, but it is not the official emergency source.

## Open Questions
- Transportation has not confirmed whether bus route reminders can be published through Campus Companion.
- Counseling needs to confirm the launch plan for students who have not activated their district Google accounts.
- Student activities needs to decide whether students can follow individual clubs for optional notifications after the pilot.
