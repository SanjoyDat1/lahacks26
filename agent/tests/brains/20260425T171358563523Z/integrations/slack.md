---
id: integrations.slack
type: integration
title: Slack Integration
status: active
importance: medium
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md
  - context/constraints.md
  - context/open_questions.md
  - decisions/decision_log.md
  - integrations/meetings.md
keywords:
  - Slack
  - channel
  - webhook
  - metadata
  - audit
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

-   `#founders`: Explicitly designated for capturing blockers and key decisions.
-   `#dev-sync`
-   `#product-decisions`
-   `#architecture`
-   `#launch`

## Distillation Guidance

Do not treat every Slack message as durable truth. Slack is noisy, and the generated brain should separate durable decisions from random chat. If the system cannot determine if an item is settled, it should be categorized as an open question.

Mark a Slack event as significant only when it includes:

-   An explicit decision
-   A changed requirement
-   A blocker
-   A launch constraint
-   Architecture context
-   A resolved open question

For auditability, the following metadata should be preserved for significant events:

-   Channel
-   Sender
-   Timestamp
-   Thread link
