---
id: architecture.ingestion_pipeline
type: architecture
title: Ingestion Pipeline
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.runtime_flow
  - integrations.github
  - integrations.slack
  - integrations.meetings
keywords:
  - ingestion
  - webhooks
  - normalization
---

# Ingestion Pipeline

The ingestion pipeline accepts external context and converts it into a normalized event that the rest of the app can process consistently.

## Endpoint

All sources use:

```text
POST /api/ingest/[source]
```

Supported source values:

- `github`
- `gitlab`
- `slack`
- `discord`
- `meetings`

## Validation

Webhook verification is optional in local demos and active when secrets are configured.

- GitHub uses `GITHUB_WEBHOOK_SECRET`.
- GitLab uses `GITLAB_WEBHOOK_SECRET`.
- Slack uses `SLACK_SIGNING_SECRET`.
- Discord uses `DISCORD_WEBHOOK_SECRET`.
- Meetings use `MEETINGS_WEBHOOK_SECRET`.

## Normalization Contract

Every source becomes a `NormalizedEvent`:

- `source`
- `sourceEventId`
- `sourceUrl`
- `actor`
- `title`
- `body`
- `repository`
- `channel`
- `eventType`
- `payload`

## Useful Coding Context

If adding a new source, update:

- `src/lib/types.ts`
- `src/lib/ingest/normalizers.ts`
- `src/lib/ingest/security.ts`
- `src/lib/db/store.ts` integration list if it should appear in the UI
- this brain folder's integration files and map
