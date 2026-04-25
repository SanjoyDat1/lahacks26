---
id: integrations.github
type: integration
title: GitHub Integration
status: active
importance: high
updated: 2026-04-25
links:
  - architecture.ingestion_pipeline
  - architecture.runtime_flow
keywords:
  - GitHub
  - issues
  - pull requests
  - webhooks
---

# GitHub Integration

GitHub ingestion captures project context from issues, pull requests, and comments.

## Endpoint

```text
POST /api/ingest/github
```

## Relevant Events

- issue comments
- issue descriptions
- pull request descriptions
- pull request comments

## Verification

Set `GITHUB_WEBHOOK_SECRET` to verify `x-hub-signature-256`.

If no secret is set, the endpoint accepts payloads for local testing.

## Normalized Fields

- repository maps to `repository.full_name`
- actor maps to `sender.login`
- title maps to the issue, PR, or comment context
- body combines title, description, and comment body

## Agent Note

GitHub events often contain durable architecture and implementation decisions. Pull request descriptions are especially important because they often explain why a code change exists.
