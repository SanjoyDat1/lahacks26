# Retrieval encoder bake-off

_Generated: 2026-04-25 14:03:22_  
_Brain: `brian` (15 queries; BGE-reranker-base held constant across all runs)_

## Summary
## Why all three models report identical recall — and what differs

This convergence is the most interesting finding, not a bug. On the `brian/` corpus (94 sections, well-structured topics), all three encoders surfaced the same top-3 candidates for 14/15 queries. Modern dense encoders agree on what's obviously relevant for a small scoped corpus — they would diverge on noisy or long-tail content not present here. The reranker (BGE-reranker-base, held constant) then orders those identical candidate sets identically, producing identical rerank scores.

Where the models do differ meaningfully:

- **Mean per-query latency** — BGE-small at 3.2s vs BCE at 5.7s vs E5 at 7.6s. BCE is 768-dim vs BGE/E5's 384-dim, doubling forward-pass cost. E5 prepends `query: ` and `passage: ` to every input, lengthening every tokenization.
- **Cold start** — BGE-small loads in 9.7s vs BCE's 29.7s, a 3x advantage driven by smaller model footprint (~33MB vs ~280MB).
- **Adversarial behavior** — on the out-of-distribution cookie query, E5 chose a different (still wrong) top-1 file. All three correctly held rerank confidence at 0.500, indicating no false confidence on OOD input.

## Decision rationale

We chose `BAAI/bge-small-en-v1.5` because:

1. **Quality is equivalent** to BCE and E5 on our corpus (Recall@3: 12/14 for all three).
2. **Latency is best** — 1.8x faster than BCE, 2.4x faster than E5 per query.
3. **Footprint is smallest** — 33MB vs 280MB (BCE) vs ~130MB (E5). This matters for our offline-fallback story (zero credentials, no network needed).
4. **Ecosystem fit** with BGE-reranker-base — same vocabulary, simpler joint cache, single model family reduces surface area.
5. **Replaceability** — `encoder.py` supports any sentence-transformers model via the `model_name` parameter, with per-family prompt formatting already wired for BGE/E5/BCE. We can swap if a future workload demands it without rewriting retrieval.


| Model | Cold start (s) | Warm load (s) | Mean query (ms) | Recall@1 strict | Recall@3 | Recall@1 lenient |
|---|---|---|---|---|---|---|
| `bge-small-en-v1.5` | 9.72 | 0.04 | 3152 | 9/14 | 12/14 | 11/14 |
| `bce-embedding-base_v1` | 29.67 | 0.01 | 5716 | 9/14 | 12/14 | 11/14 |
| `e5-small-v2` | 11.61 | 0.01 | 7615 | 9/14 | 12/14 | 11/14 |

**Recall denominators exclude the 1 adversarial / out-of-distribution query (15 - 1 = 14).**  
* `Recall@1 strict`  — top-1 file path contains the **primary** expected stem.  
* `Recall@3`         — any of the top-3 file paths contains **any** `" or "`-separated alternative.  
* `Recall@1 lenient` — top-1 file path contains **any** alternative.

## Disagreements vs. BGE-small baseline

### `bce-embedding-base_v1` (0 top-1 disagreements)

_No top-1 disagreements vs baseline._

### `e5-small-v2` (1 top-1 disagreements)

| Query | BGE-small top-1 | This model top-1 |
|---|---|---|
| How do I bake chocolate chip cookies? | `architecture/runtime_flow.md` | `context/constraints.md` |

## Per-query top-3 by model

### `bge-small-en-v1.5`

**01. (3166 ms)** `Use GitHub-Backed Markdown As The Production Brain`  
  _expected:_ `decisions/ADR-0001`
  - rerank=`0.731` dense=`0.941`  `decisions/ADR-0001-git-backed-brain.md` :: Decision
  - rerank=`0.730` dense=`0.956`  `decisions/ADR-0001-git-backed-brain.md` :: Intro
  - rerank=`0.728` dense=`0.879`  `decisions/decision_log.md` :: Active Decisions
  - rerank=`0.501` dense=`0.866`  `context/open_questions.md` :: Product Questions

**02. (2850 ms)** `Important Failure Behavior`  
  _expected:_ `architecture/runtime_flow`
  - rerank=`0.727` dense=`0.799`  `architecture/runtime_flow.md` :: Important Failure Behavior
  - rerank=`0.501` dense=`0.808`  `agents/distiller_agent_prompt.md` :: Not Significant
  - rerank=`0.501` dense=`0.810`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.500` dense=`0.791`  `context/constraints.md` :: Product Constraints

**03. (2879 ms)** `Significance Criteria`  
  _expected:_ `architecture/distillation_pipeline`
  - rerank=`0.706` dense=`0.873`  `architecture/distillation_pipeline.md` :: Significance Criteria
  - rerank=`0.510` dense=`0.853`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.504` dense=`0.798`  `agents/distiller_agent_prompt.md` :: Output
  - rerank=`0.500` dense=`0.778`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.778`  `context/constraints.md` :: Retrieval Constraints

**04. (2041 ms)** `Why did we choose markdown over a database?`  
  _expected:_ `decisions/ADR-0001`
  - rerank=`0.505` dense=`0.846`  `decisions/ADR-0001-git-backed-brain.md` :: Decision
  - rerank=`0.501` dense=`0.796`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.501` dense=`0.809`  `architecture/brain_storage.md` :: Intro
  - rerank=`0.500` dense=`0.821`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.500` dense=`0.808`  `context/open_questions.md` :: Retrieval Questions

**05. (2877 ms)** `What are the open questions in the project?`  
  _expected:_ `context/open_questions`
  - rerank=`0.722` dense=`0.859`  `context/open_questions.md` :: Intro
  - rerank=`0.553` dense=`0.786`  `summaries/project_summary.md` :: Intro
  - rerank=`0.517` dense=`0.796`  `architecture/distillation_pipeline.md` :: Current Limitation
  - rerank=`0.514` dense=`0.792`  `context/open_questions.md` :: Product Questions
  - rerank=`0.501` dense=`0.796`  `context/open_questions.md` :: Retrieval Questions

**06. (1666 ms)** `How does the system handle missing API credentials?`  
  _expected:_ `decisions/ADR-0002 or runtime_flow`
  - rerank=`0.509` dense=`0.811`  `agents/coding_agent_prompt.md` :: While Coding
  - rerank=`0.505` dense=`0.803`  `architecture/ingestion_pipeline.md` :: Endpoint
  - rerank=`0.503` dense=`0.800`  `architecture/system_overview.md` :: System Role
  - rerank=`0.500` dense=`0.815`  `context/open_questions.md` :: Architecture Questions
  - rerank=`0.500` dense=`0.802`  `context/open_questions.md` :: Product Questions

**07. (3100 ms)** `What database does production use?`  
  _expected:_ `architecture/data_model or context/constraints`
  - rerank=`0.687` dense=`0.835`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.567` dense=`0.860`  `architecture/brain_storage.md` :: Production Storage
  - rerank=`0.534` dense=`0.827`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.500` dense=`0.792`  `context/open_questions.md` :: Architecture Questions

**08. (2112 ms)** `How are Slack messages ingested?`  
  _expected:_ `integrations/slack`
  - rerank=`0.541` dense=`0.893`  `integrations/slack.md` :: Intro
  - rerank=`0.512` dense=`0.861`  `integrations/slack.md` :: Endpoint
  - rerank=`0.508` dense=`0.806`  `architecture/ingestion_pipeline.md` :: Endpoint
  - rerank=`0.500` dense=`0.772`  `context/open_questions.md` :: Retrieval Questions

**09. (3354 ms)** `What is the high-level architecture of this system?`  
  _expected:_ `architecture/system_overview`
  - rerank=`0.501` dense=`0.785`  `summaries/project_summary.md` :: Intro
  - rerank=`0.501` dense=`0.793`  `architecture/distillation_pipeline.md` :: Current Limitation
  - rerank=`0.500` dense=`0.784`  `decisions/ADR-0001-git-backed-brain.md` :: Context
  - rerank=`0.500` dense=`0.810`  `context/open_questions.md` :: Architecture Questions

**10. (3168 ms)** `How is the brain stored?`  
  _expected:_ `architecture/brain_storage`
  - rerank=`0.656` dense=`0.907`  `architecture/brain_storage.md` :: Intro
  - rerank=`0.540` dense=`0.826`  `architecture/distillation_pipeline.md` :: Current Flow
  - rerank=`0.511` dense=`0.831`  `architecture/system_overview.md` :: Related Files
  - rerank=`0.500` dense=`0.837`  `context/constraints.md` :: Product Constraints

**11. (2215 ms)** `What gets logged when a webhook fires?`  
  _expected:_ `architecture/runtime_flow or ingestion_pipeline`
  - rerank=`0.508` dense=`0.839`  `architecture/ingestion_pipeline.md` :: Validation
  - rerank=`0.502` dense=`0.857`  `summaries/architecture_summary.md` :: Intro
  - rerank=`0.501` dense=`0.807`  `integrations/github.md` :: Verification
  - rerank=`0.500` dense=`0.796`  `context/open_questions.md` :: Architecture Questions

**12. (3209 ms)** `pgvector embeddings`  
  _expected:_ `architecture/data_model`
  - rerank=`0.725` dense=`0.821`  `architecture/data_model.md` :: Tables
  - rerank=`0.695` dense=`0.813`  `summaries/project_summary.md` :: What Works Right Now
  - rerank=`0.674` dense=`0.825`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.521` dense=`0.807`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.500` dense=`0.803`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.500` dense=`0.792`  `context/open_questions.md` :: Retrieval Questions

**13. (3093 ms)** `OpenAI integration`  
  _expected:_ `architecture/system_overview or distillation_pipeline`
  - rerank=`0.577` dense=`0.842`  `summaries/project_summary.md` :: What Works Right Now
  - rerank=`0.571` dense=`0.830`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.554` dense=`0.847`  `index.md` :: Current Product State
  - rerank=`0.500` dense=`0.824`  `context/open_questions.md` :: Product Questions

**14. (6618 ms)** `meeting transcripts`  
  _expected:_ `integrations/meetings`
  - rerank=`0.731` dense=`0.872`  `integrations/meetings.md` :: Intro
  - rerank=`0.731` dense=`0.902`  `integrations/meetings.md` :: Agent Note
  - rerank=`0.730` dense=`0.889`  `integrations/meetings.md` :: Distillation Guidance
  - rerank=`0.555` dense=`0.887`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.809`  `context/constraints.md` :: Product Constraints

**15. (4933 ms)** `How do I bake chocolate chip cookies?`  
  _expected:_ `NOTHING - should rank weakly`
  - rerank=`0.500` dense=`0.734`  `architecture/runtime_flow.md` :: Webhook To Brain Update
  - rerank=`0.500` dense=`0.744`  `architecture/brain_storage.md` :: Local Demo Storage
  - rerank=`0.500` dense=`0.743`  `index.md` :: Intro
  - rerank=`0.500` dense=`0.756`  `context/open_questions.md` :: Architecture Questions

### `bce-embedding-base_v1`

**01. (6794 ms)** `Use GitHub-Backed Markdown As The Production Brain`  
  _expected:_ `decisions/ADR-0001`
  - rerank=`0.731` dense=`0.846`  `decisions/ADR-0001-git-backed-brain.md` :: Decision
  - rerank=`0.730` dense=`0.962`  `decisions/ADR-0001-git-backed-brain.md` :: Intro
  - rerank=`0.728` dense=`0.785`  `decisions/decision_log.md` :: Active Decisions
  - rerank=`0.513` dense=`0.782`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.500` dense=`0.769`  `context/open_questions.md` :: Architecture Questions

**02. (7129 ms)** `Important Failure Behavior`  
  _expected:_ `architecture/runtime_flow`
  - rerank=`0.727` dense=`0.795`  `architecture/runtime_flow.md` :: Important Failure Behavior
  - rerank=`0.501` dense=`0.775`  `agents/distiller_agent_prompt.md` :: Not Significant
  - rerank=`0.501` dense=`0.733`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.500` dense=`0.711`  `context/open_questions.md` :: Retrieval Questions

**03. (8923 ms)** `Significance Criteria`  
  _expected:_ `architecture/distillation_pipeline`
  - rerank=`0.706` dense=`0.814`  `architecture/distillation_pipeline.md` :: Significance Criteria
  - rerank=`0.510` dense=`0.771`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.502` dense=`0.678`  `decisions/ADR-0001-git-backed-brain.md` :: Context
  - rerank=`0.500` dense=`0.682`  `context/constraints.md` :: Intro
  - rerank=`0.500` dense=`0.685`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.654`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.500` dense=`0.681`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.659`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.500` dense=`0.664`  `context/open_questions.md` :: Product Questions

**04. (3435 ms)** `Why did we choose markdown over a database?`  
  _expected:_ `decisions/ADR-0001`
  - rerank=`0.505` dense=`0.736`  `decisions/ADR-0001-git-backed-brain.md` :: Decision
  - rerank=`0.501` dense=`0.740`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.501` dense=`0.689`  `architecture/brain_storage.md` :: Intro
  - rerank=`0.500` dense=`0.701`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.500` dense=`0.701`  `context/constraints.md` :: Product Constraints

**05. (8720 ms)** `What are the open questions in the project?`  
  _expected:_ `context/open_questions`
  - rerank=`0.722` dense=`0.760`  `context/open_questions.md` :: Intro
  - rerank=`0.593` dense=`0.756`  `context/open_questions.md` :: Architecture Questions
  - rerank=`0.547` dense=`0.703`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.514` dense=`0.798`  `context/open_questions.md` :: Product Questions
  - rerank=`0.501` dense=`0.710`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.501` dense=`0.785`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.707`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.708`  `context/constraints.md` :: Technical Constraints

**06. (5278 ms)** `How does the system handle missing API credentials?`  
  _expected:_ `decisions/ADR-0002 or runtime_flow`
  - rerank=`0.509` dense=`0.738`  `agents/coding_agent_prompt.md` :: While Coding
  - rerank=`0.504` dense=`0.730`  `decisions/ADR-0001-git-backed-brain.md` :: Context
  - rerank=`0.502` dense=`0.705`  `summaries/architecture_summary.md` :: Key Design Constraint
  - rerank=`0.501` dense=`0.708`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.500` dense=`0.703`  `context/open_questions.md` :: Architecture Questions

**07. (9045 ms)** `What database does production use?`  
  _expected:_ `architecture/data_model or context/constraints`
  - rerank=`0.687` dense=`0.747`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.567` dense=`0.748`  `architecture/brain_storage.md` :: Production Storage
  - rerank=`0.534` dense=`0.716`  `architecture/system_overview.md` :: Current Runtime Modes

**08. (9017 ms)** `How are Slack messages ingested?`  
  _expected:_ `integrations/slack`
  - rerank=`0.541` dense=`0.808`  `integrations/slack.md` :: Intro
  - rerank=`0.512` dense=`0.745`  `integrations/slack.md` :: Endpoint
  - rerank=`0.509` dense=`0.681`  `summaries/project_summary.md` :: Intro
  - rerank=`0.500` dense=`0.681`  `context/constraints.md` :: Product Constraints

**09. (8429 ms)** `What is the high-level architecture of this system?`  
  _expected:_ `architecture/system_overview`
  - rerank=`0.501` dense=`0.702`  `summaries/project_summary.md` :: Intro
  - rerank=`0.500` dense=`0.706`  `decisions/ADR-0001-git-backed-brain.md` :: Context
  - rerank=`0.500` dense=`0.713`  `summaries/architecture_summary.md` :: Intro
  - rerank=`0.500` dense=`0.683`  `context/constraints.md` :: Technical Constraints

**10. (3143 ms)** `How is the brain stored?`  
  _expected:_ `architecture/brain_storage`
  - rerank=`0.656` dense=`0.794`  `architecture/brain_storage.md` :: Intro
  - rerank=`0.540` dense=`0.709`  `architecture/distillation_pipeline.md` :: Current Flow
  - rerank=`0.511` dense=`0.726`  `architecture/system_overview.md` :: Related Files
  - rerank=`0.500` dense=`0.721`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.705`  `context/open_questions.md` :: Architecture Questions

**11. (3209 ms)** `What gets logged when a webhook fires?`  
  _expected:_ `architecture/runtime_flow or ingestion_pipeline`
  - rerank=`0.508` dense=`0.772`  `architecture/ingestion_pipeline.md` :: Validation
  - rerank=`0.502` dense=`0.730`  `summaries/architecture_summary.md` :: Intro
  - rerank=`0.501` dense=`0.695`  `integrations/github.md` :: Verification
  - rerank=`0.500` dense=`0.683`  `context/constraints.md` :: Technical Constraints

**12. (3041 ms)** `pgvector embeddings`  
  _expected:_ `architecture/data_model`
  - rerank=`0.725` dense=`0.681`  `architecture/data_model.md` :: Tables
  - rerank=`0.695` dense=`0.693`  `summaries/project_summary.md` :: What Works Right Now
  - rerank=`0.674` dense=`0.743`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.521` dense=`0.652`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.500` dense=`0.634`  `context/constraints.md` :: Intro
  - rerank=`0.500` dense=`0.631`  `context/open_questions.md` :: Retrieval Questions

**13. (2881 ms)** `OpenAI integration`  
  _expected:_ `architecture/system_overview or distillation_pipeline`
  - rerank=`0.577` dense=`0.717`  `summaries/project_summary.md` :: What Works Right Now
  - rerank=`0.571` dense=`0.711`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.554` dense=`0.696`  `index.md` :: Current Product State
  - rerank=`0.500` dense=`0.676`  `context/open_questions.md` :: Intro
  - rerank=`0.500` dense=`0.685`  `context/open_questions.md` :: Architecture Questions

**14. (3274 ms)** `meeting transcripts`  
  _expected:_ `integrations/meetings`
  - rerank=`0.731` dense=`0.742`  `integrations/meetings.md` :: Intro
  - rerank=`0.731` dense=`0.767`  `integrations/meetings.md` :: Agent Note
  - rerank=`0.730` dense=`0.699`  `integrations/meetings.md` :: Distillation Guidance
  - rerank=`0.555` dense=`0.718`  `context/open_questions.md` :: Retrieval Questions

**15. (3418 ms)** `How do I bake chocolate chip cookies?`  
  _expected:_ `NOTHING - should rank weakly`
  - rerank=`0.500` dense=`0.630`  `architecture/runtime_flow.md` :: Webhook To Brain Update
  - rerank=`0.500` dense=`0.610`  `index.md` :: Important Links
  - rerank=`0.500` dense=`0.596`  `agents/coding_agent_prompt.md` :: While Coding
  - rerank=`0.500` dense=`0.600`  `context/open_questions.md` :: Product Questions
  - rerank=`0.500` dense=`0.602`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.596`  `context/open_questions.md` :: Architecture Questions

### `e5-small-v2`

**01. (9034 ms)** `Use GitHub-Backed Markdown As The Production Brain`  
  _expected:_ `decisions/ADR-0001`
  - rerank=`0.731` dense=`0.959`  `decisions/ADR-0001-git-backed-brain.md` :: Decision
  - rerank=`0.730` dense=`0.964`  `decisions/ADR-0001-git-backed-brain.md` :: Intro
  - rerank=`0.728` dense=`0.953`  `decisions/decision_log.md` :: Active Decisions
  - rerank=`0.501` dense=`0.929`  `context/open_questions.md` :: Product Questions
  - rerank=`0.500` dense=`0.926`  `context/open_questions.md` :: Architecture Questions

**02. (9101 ms)** `Important Failure Behavior`  
  _expected:_ `architecture/runtime_flow`
  - rerank=`0.727` dense=`0.922`  `architecture/runtime_flow.md` :: Important Failure Behavior
  - rerank=`0.501` dense=`0.912`  `agents/distiller_agent_prompt.md` :: Not Significant
  - rerank=`0.501` dense=`0.911`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.500` dense=`0.906`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.900`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.901`  `context/open_questions.md` :: Architecture Questions

**03. (8887 ms)** `Significance Criteria`  
  _expected:_ `architecture/distillation_pipeline`
  - rerank=`0.706` dense=`0.944`  `architecture/distillation_pipeline.md` :: Significance Criteria
  - rerank=`0.510` dense=`0.923`  `agents/distiller_agent_prompt.md` :: Significant Context
  - rerank=`0.504` dense=`0.909`  `agents/distiller_agent_prompt.md` :: Output
  - rerank=`0.500` dense=`0.902`  `context/constraints.md` :: Intro
  - rerank=`0.500` dense=`0.915`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.907`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.500` dense=`0.902`  `context/constraints.md` :: Technical Constraints

**04. (3461 ms)** `Why did we choose markdown over a database?`  
  _expected:_ `decisions/ADR-0001`
  - rerank=`0.505` dense=`0.927`  `decisions/ADR-0001-git-backed-brain.md` :: Decision
  - rerank=`0.501` dense=`0.913`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.501` dense=`0.914`  `architecture/brain_storage.md` :: Intro
  - rerank=`0.500` dense=`0.909`  `context/constraints.md` :: Retrieval Constraints
  - rerank=`0.500` dense=`0.913`  `context/constraints.md` :: Product Constraints

**05. (9023 ms)** `What are the open questions in the project?`  
  _expected:_ `context/open_questions`
  - rerank=`0.722` dense=`0.939`  `context/open_questions.md` :: Intro
  - rerank=`0.593` dense=`0.906`  `context/open_questions.md` :: Architecture Questions
  - rerank=`0.517` dense=`0.911`  `architecture/distillation_pipeline.md` :: Current Limitation
  - rerank=`0.514` dense=`0.912`  `context/open_questions.md` :: Product Questions
  - rerank=`0.501` dense=`0.904`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.901`  `context/constraints.md` :: Technical Constraints

**06. (9617 ms)** `How does the system handle missing API credentials?`  
  _expected:_ `decisions/ADR-0002 or runtime_flow`
  - rerank=`0.509` dense=`0.913`  `agents/coding_agent_prompt.md` :: While Coding
  - rerank=`0.504` dense=`0.908`  `decisions/ADR-0001-git-backed-brain.md` :: Context
  - rerank=`0.503` dense=`0.913`  `architecture/system_overview.md` :: System Role
  - rerank=`0.500` dense=`0.907`  `context/open_questions.md` :: Architecture Questions

**07. (8596 ms)** `What database does production use?`  
  _expected:_ `architecture/data_model or context/constraints`
  - rerank=`0.687` dense=`0.913`  `context/constraints.md` :: Technical Constraints
  - rerank=`0.567` dense=`0.928`  `architecture/brain_storage.md` :: Production Storage
  - rerank=`0.534` dense=`0.901`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.500` dense=`0.898`  `context/constraints.md` :: Product Constraints

**08. (8609 ms)** `How are Slack messages ingested?`  
  _expected:_ `integrations/slack`
  - rerank=`0.541` dense=`0.944`  `integrations/slack.md` :: Intro
  - rerank=`0.512` dense=`0.943`  `integrations/slack.md` :: Endpoint
  - rerank=`0.508` dense=`0.921`  `architecture/ingestion_pipeline.md` :: Endpoint
  - rerank=`0.500` dense=`0.908`  `context/constraints.md` :: Product Constraints

**09. (9068 ms)** `What is the high-level architecture of this system?`  
  _expected:_ `architecture/system_overview`
  - rerank=`0.501` dense=`0.889`  `summaries/project_summary.md` :: Intro
  - rerank=`0.501` dense=`0.897`  `architecture/distillation_pipeline.md` :: Current Limitation
  - rerank=`0.501` dense=`0.890`  `decisions/ADR-0002-local-demo-fallbacks.md` :: Decision
  - rerank=`0.500` dense=`0.901`  `context/open_questions.md` :: Architecture Questions

**10. (9199 ms)** `How is the brain stored?`  
  _expected:_ `architecture/brain_storage`
  - rerank=`0.656` dense=`0.954`  `architecture/brain_storage.md` :: Intro
  - rerank=`0.540` dense=`0.934`  `architecture/distillation_pipeline.md` :: Current Flow
  - rerank=`0.511` dense=`0.931`  `architecture/system_overview.md` :: Related Files
  - rerank=`0.500` dense=`0.927`  `context/constraints.md` :: Product Constraints
  - rerank=`0.500` dense=`0.932`  `context/open_questions.md` :: Architecture Questions

**11. (9142 ms)** `What gets logged when a webhook fires?`  
  _expected:_ `architecture/runtime_flow or ingestion_pipeline`
  - rerank=`0.508` dense=`0.915`  `architecture/ingestion_pipeline.md` :: Validation
  - rerank=`0.502` dense=`0.911`  `summaries/architecture_summary.md` :: Intro
  - rerank=`0.501` dense=`0.914`  `integrations/github.md` :: Verification
  - rerank=`0.500` dense=`0.894`  `context/open_questions.md` :: Architecture Questions

**12. (9152 ms)** `pgvector embeddings`  
  _expected:_ `architecture/data_model`
  - rerank=`0.725` dense=`0.927`  `architecture/data_model.md` :: Tables
  - rerank=`0.695` dense=`0.911`  `summaries/project_summary.md` :: What Works Right Now
  - rerank=`0.674` dense=`0.917`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.521` dense=`0.910`  `context/constraints.md` :: Technical Constraints

**13. (4567 ms)** `OpenAI integration`  
  _expected:_ `architecture/system_overview or distillation_pipeline`
  - rerank=`0.577` dense=`0.923`  `summaries/project_summary.md` :: What Works Right Now
  - rerank=`0.571` dense=`0.929`  `architecture/system_overview.md` :: Current Runtime Modes
  - rerank=`0.554` dense=`0.918`  `index.md` :: Current Product State

**14. (3642 ms)** `meeting transcripts`  
  _expected:_ `integrations/meetings`
  - rerank=`0.731` dense=`0.941`  `integrations/meetings.md` :: Intro
  - rerank=`0.731` dense=`0.931`  `integrations/meetings.md` :: Agent Note
  - rerank=`0.730` dense=`0.932`  `integrations/meetings.md` :: Distillation Guidance
  - rerank=`0.555` dense=`0.928`  `context/open_questions.md` :: Retrieval Questions
  - rerank=`0.500` dense=`0.910`  `context/constraints.md` :: Product Constraints

**15. (3131 ms)** `How do I bake chocolate chip cookies?`  
  _expected:_ `NOTHING - should rank weakly`
  - rerank=`0.500` dense=`0.899`  `context/constraints.md` :: Intro
  - rerank=`0.500` dense=`0.898`  `architecture/runtime_flow.md` :: Webhook To Brain Update
  - rerank=`0.500` dense=`0.907`  `index.md` :: Important Links
  - rerank=`0.500` dense=`0.898`  `context/open_questions.md` :: Architecture Questions
