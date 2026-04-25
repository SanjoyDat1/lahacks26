---
id: integrations.slack
type: integration
title: Slack Integration
status: active
importance: medium
updated: '2026-04-25'
links:
  - architecture.ingestion_pipeline
  - context.constraints
  - agents.coding_agent_prompt
keywords:
  - Slack
  - channel
  - webhook
  - dev sync
---
# Slack Integration

Slack ingestion captures messages from selected project channels.

## Endpoint

```text
POST /api/ingest/slack
```

## Verification

Set `SLACK_SIGNING_SECRET` to verify Slack request signatures.

The endpoint also supports Slack URL verification by returning the `challenge` field.

## Recommended Channels

- `#dev-sync`
- `#product-decisions`
- `#architecture`
- `#launch`

## Distillation Guidance

Do not treat every Slack message as durable truth. Slack is noisy.

Mark a Slack event as significant only when it includes:

- an explicit decision
- a changed requirement
- a blocker
- a launch constraint
- architecture context
- a resolved open question
