---
id: decisions.decision_log
type: decision_log
title: Decision Log
status: active
importance: critical
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md
  - context/constraints.md
  - context/open_questions.md
  - decisions/decision_log.md
  - integrations/slack.md
  - integrations/meetings.md
keywords:
  - decisions
  - LA Hacks
  - operations
  - rationale
---

# Decision Log

This file lists durable product and architecture decisions. Detailed decisions should live in ADR files.

## Active Decisions

| ID | Decision | Status | Link |
| --- | --- | --- | --- |
| DEC-001 | Use `https://app.lahacks.dev/callback` for all public callback URLs during demo day. | Accepted | |
| DEC-002 | The reimbursement CSV export must include hacker id, school, payment status, and reviewer initials. | Accepted | |
| DEC-003 | The local demo must work reliably without network access or cached embedding models, including a deterministic update path and a fallback mechanism (e.g., BGE first, then BM25). | Accepted | |
| DEC-004 | The brain must expose a distinct read path (non-mutating, e.g., `brain_query`) and write path (e.g., `brain_update` which can return a plan). | Accepted | |
| DEC-005 | The audit trail for brain updates must be append-only. | Accepted | |
| DEC-006 | The generated brain must separate durable decisions from chat/transient information; uncertain items go to open questions. | Accepted | |
| DEC-007 | The registration data cutoff is 5 PM Pacific on Tuesday; subsequent fixes are manual exceptions. | Accepted | |
| DEC-008 | Slack ingestion must preserve channel, sender, timestamp, and thread link for auditability. | Accepted | |
| DEC-009 | Meeting transcripts will be manually uploaded for the demo; calendar sync is not a solved problem. | Accepted | |
| DEC-010 | Notion is the live launch checklist for the demo. | Accepted | |
| DEC-011 | Taylor is responsible for cleaning up and posting final sponsor logo assets. | Accepted | |
| DEC-012 | The `#founders` Slack channel is the designated place for communicating launch blockers. | Accepted | |

## Decision Rules

- Do not delete old decisions.
- If a decision changes, write a new ADR that supersedes the previous one.
- Link decisions to impacted architecture files.
- Keep decisions short enough that agents can scan them quickly.
