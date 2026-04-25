---
id: context.constraints
type: context
title: Constraints
status: active
importance: high
updated: 2026-04-25
links:
  - index.md
  - summaries/project_summary.md
  - context/open_questions.md
  - decisions/decision_log.md
  - integrations/slack.md
  - integrations/meetings.md
keywords:
  - constraints
  - assumptions
  - limitations
---

# Constraints

## Technical Constraints

- The OAuth callback domain must be `https://app.lahacks.dev/callback` for demo day.
- The local demo must run without an API key or external credentials and produce an auditable plan.
- The brain must expose distinct read (`brain_query`) and write (`brain_update`) paths; the read path must not mutate files.
- The brain's audit trail must be append-only.
- Tests must not depend on cached embedding models; they should be runnable locally without downloading large models.
- Registration data entry cutoff is Tuesday, 5 PM Pacific; subsequent fixes are manual exceptions.
- The retrieval system must have a fallback (e.g., BM25) if advanced embedding models (e.g., BGE) are unavailable or fail to load, and should not require network or a GPU for demo.
- Calendar sync for meeting ingestion is not solved and will be handled via manual transcript uploads for the demo.

## Product Constraints

- The brain must be understandable by humans and LLMs.
- Brain files should not become noisy dumps of raw transcripts or chat logs.
- Significant updates should explain their source and rationale.
- Important files should be graph-linked so they are not orphaned.
- The generated brain must separate durable decisions from random chat; uncertain items should be marked as open questions.
- The reimbursement CSV export must include hacker id, school, payment status, and reviewer initials.
- Legal review is required for the volunteer FAQ section on overnight access and university policy before public release.
- The reimbursement blurb in the FAQ must be rewritten to reflect current policies after final export fields are confirmed by ops.
- Notion is the live launch checklist for the demo.
- `#founders` Slack channel is where launch blockers should be brought.

## Retrieval Constraints

- Agents should read summaries before long files.
- Frontmatter should contain machine-usable metadata.
- Body content should prioritize meaning over template rigidity.
- Boilerplate should be minimized because it wastes retrieval and context-window budget.
- Slack ingestion must preserve channel, sender, timestamp, and thread link for auditability, rather than just message text.
- The brain must stay human-readable Markdown.
## Updates

- 2026-04-25: The platform team must publish export status in #founders before judging. ([meeting](https://meetings.example.test/platform-sync))
