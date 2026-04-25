---
id: integrations.meetings
type: integration
title: Meeting Transcript Integration
status: active
importance: medium
updated: 2026-04-25
links:
  - architecture.ingestion_pipeline
  - architecture.distillation_pipeline
keywords:
  - meetings
  - transcripts
  - AssemblyAI
  - Deepgram
---

# Meeting Transcript Integration

Meeting ingestion accepts transcript-style payloads from tools such as AssemblyAI, Deepgram, or manual transcript upload workflows.

## Endpoint

```text
POST /api/ingest/meetings
```

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

Meeting transcripts are high-signal but long. The distiller should extract:

- decisions
- constraints
- requirements
- unresolved questions
- ownership
- deadlines

## Agent Note

Meeting transcripts should usually be summarized into specific brain files rather than copied wholesale. Raw transcript text belongs in searchable documents, not permanent brain files.
