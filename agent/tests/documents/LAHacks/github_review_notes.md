---
source: github
pull_request: 42
timestamp: 2026-04-24T22:10:00-07:00
---

# GitHub Review Notes

Reviewer A: I like the direction, but the demo still has to work for somebody who cloned the repo five minutes before judging. Please keep a deterministic update path around for the local flow. It does not need to be beautiful, but it needs to run without an API key and produce an auditable plan.

Reviewer B: The MCP wrapper is small enough, but make sure we can call one read path and one write path from outside the app. I think the names in the doc were brain_query and brain_update. The read path should not mutate files. The write path can return a plan when apply is false.

Reviewer C: Please keep the audit trail append-only. During the demo, it is probably the only way we can explain why a brain update happened if someone asks.

Reviewer D: I noticed the bootstrap prompt sometimes pulls too much from a noisy document. That is fine for now, but the generated brain should separate durable decisions from random chat. If it cannot tell, put the item into open questions instead of pretending it is settled.

Reviewer A: Tiny thing: do not make the tests depend on cached embedding models. Retrieval should be meaningful, but the test should still be runnable on a laptop that has never downloaded BGE.
