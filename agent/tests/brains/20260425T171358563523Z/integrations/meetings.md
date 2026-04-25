---
id: integrations.meetings
type: integration
title: Meeting Transcript Integration
status: active
importance: medium
updated: 2026-04-25
links:
  - context/open_questions.md
keywords:
  - meetings
  - transcripts
  - manual upload
  - demo
  - ingestion
---

# Meeting Transcript Integration

Meeting ingestion accepts transcript-style payloads. For the demo, meeting transcripts are primarily ingested via manual upload workflows due to challenges with automated calendar synchronization. Direct calendar scraping attempts encountered issues with private events and duplicate recurring meetings, leading to a decision to prioritize manual upload for the immediate demo needs.

## Endpoint

```text
POST /api/ingest/meetings
```

While an API endpoint like `/api/ingest/meetings` is envisioned for automated ingestion, for the LA Hacks demo, meeting transcripts are currently ingested via manual upload.

## Accepted Payload Shape

Useful fields include:

- `id`
- `title`
- `transcript`
- `text`
- `summary`
- `organizer`
- `audio_url`

## Distillation Guidance

Meeting transcripts are high-signal but can be lengthy. The distillation process should extract:

- decisions
- constraints
- requirements
- unresolved questions
- ownership
- deadlines

The generated brain content should clearly separate durable decisions from chat, placing uncertain items into open questions rather than presenting them as settled.

## Agent Note

Meeting transcripts should usually be summarized into specific brain files rather than copied wholesale. Raw transcript text belongs in searchable documents, not permanent brain files, to avoid noise and maintain an auditable record.
