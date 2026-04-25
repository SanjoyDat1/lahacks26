---
id: summaries.project_summary
type: summary
title: LA Hacks Operations Brain Summary
status: active
importance: critical
updated: 2026-04-25
links:
  - index
  - summaries.project_summary
  - context.constraints
  - context.open_questions
  - decisions.decision_log
  - integrations.slack
  - integrations.meetings
keywords:
  - LA Hacks
  - operations
  - summary
  - current state
  - quick context
---

# LA Hacks Operations Brain Summary

The LA Hacks Operations Brain is designed to capture and synchronize critical operational context for the LA Hacks event. It aggregates information from various sources like Slack, meeting transcripts, emails, and review notes to provide a single, auditable source of truth for durable decisions, operational constraints, and open questions. The goal is to reduce noise and ensure key information is accessible and clearly categorized for effective event management.

## What Works Right Now

-   **Public Callback URLs**: All public callback URLs for demo day are configured to use `https://app.lahacks.dev/callback`.
-   **Reimbursement CSV Export**: The required export format for finance is defined, including hacker id, school, payment status, and reviewer initials.
-   **Local Demo Flow**: A deterministic update path is in place for local demos, allowing the system to run and produce an auditable plan without requiring an external API key or network access for embedding models.
-   **Brain Read/Write Paths**: Defined interfaces for `brain_query` (read-only) and `brain_update` (write, with an option to return a plan without applying).
-   **Audit Trail**: All brain updates are designed to be append-only, providing a clear history of changes.
-   **Information Distillation**: The system aims to separate durable decisions from transient discussions, categorizing uncertain items as open questions rather than settled facts.
-   **Retrieval Fallback**: The demo's retrieval mechanism prioritizes BGE embeddings when available but gracefully falls back to BM25 keyword-based search if BGE models are not cached or accessible, ensuring local functionality without network or GPU.
-   **Slack Ingestion Metadata**: For auditability, Slack ingestion preserves essential metadata including channel, sender, timestamp, and thread link.
-   **Launch Checklist Source**: Notion is established as the live source of truth for the launch checklist.
-   **Sponsor Logos Ownership**: Taylor is responsible for finalizing and posting all sponsor logo assets.
-   **Blocker Communication**: The `#founders` Slack channel is designated for reporting launch-blocking issues.

## Fastest Local Test

A quick local test should demonstrate the system's ability to ingest raw operational documents and present the distilled information. This would involve:

1.  Feeding sample Slack, email, and meeting transcript data into the local brain.
2.  Verifying that key decisions, constraints, and open questions are correctly identified and stored.
3.  Confirming that a semantic or keyword search can retrieve relevant operational context without external dependencies.

## Agent Guidance

Before changing code, read this file, then read the specific architecture or decision files linked from the task.
