// Agent simulation scenarios — each defines an ordered sequence of brain file reads
// with justifications, mirroring what a real coding agent does before touching code.

export type Relevance = "primary" | "secondary" | "referenced";

export type FileRead = {
  id: string;          // frontmatter id
  title: string;       // display name
  relevance: Relevance;
  reason: string;      // why the agent reads this file at this step
};

export type AgentStep = {
  action: string;      // short verb phrase shown as step header
  thinking: string;    // agent's internal monologue (shown in trace)
  files: FileRead[];
};

export type Scenario = {
  id: string;
  name: string;
  description: string;
  colorClass: string;  // Tailwind color class prefix (used for borders, dots, etc.)
  icon: string;
  steps: AgentStep[];
};

export const SCENARIOS: Scenario[] = [
  {
    id: "onboard",
    name: "Onboard to Codebase",
    description: "New agent session — orient to project structure before writing any code",
    colorClass: "blue",
    icon: "⚡",
    steps: [
      {
        action: "Load the index",
        thinking:
          "I always start with the index — it's the authoritative map of everything this brain knows. I need to understand the topology before touching anything.",
        files: [
          {
            id: "brian.index",
            title: "Brian Project Brain",
            relevance: "primary",
            reason: "Entry point to the entire knowledge graph — tells me what exists and where to look",
          },
          {
            id: "brian.map",
            title: "Knowledge Map",
            relevance: "secondary",
            reason: "Mermaid graph of file relationships — gives me the visual dependency structure",
          },
        ],
      },
      {
        action: "Read the project summary",
        thinking:
          "Now I need the high-level picture — what does this system do, who uses it, and what problem does it solve? This shapes every decision I make.",
        files: [
          {
            id: "summaries.project_summary",
            title: "Project Summary",
            relevance: "primary",
            reason: "Defines what this system is — I must know the mission before writing code",
          },
          {
            id: "goals.product_goals",
            title: "Product Goals",
            relevance: "secondary",
            reason: "Ensures my changes align with stated product direction, not just current implementation",
          },
        ],
      },
      {
        action: "Study the architecture",
        thinking:
          "With context established, I dig into the system design — runtime flow, components, and how data moves through the stack.",
        files: [
          {
            id: "architecture.system_overview",
            title: "System Overview",
            relevance: "primary",
            reason: "Full picture of components and their relationships — the blueprint I reason from",
          },
          {
            id: "architecture.runtime_flow",
            title: "Runtime Flow",
            relevance: "primary",
            reason: "Shows exactly how a request moves from ingestion through distillation to the brain",
          },
          {
            id: "summaries.architecture_summary",
            title: "Architecture Summary",
            relevance: "secondary",
            reason: "Condensed narrative of architectural decisions — faster to parse than raw files",
          },
        ],
      },
      {
        action: "Read agent contracts",
        thinking:
          "Finally, I read my own prompt and the distiller's prompt — I need to know the rules I operate under and not violate constraints set by the system.",
        files: [
          {
            id: "agents.coding_agent_prompt",
            title: "Coding Agent Prompt",
            relevance: "primary",
            reason: "My own operating instructions — I must internalize these before acting",
          },
          {
            id: "agents.distiller_agent_prompt",
            title: "Distiller Agent Prompt",
            relevance: "referenced",
            reason: "Understanding the distiller's role prevents me from duplicating its work",
          },
          {
            id: "context.constraints",
            title: "Constraints",
            relevance: "secondary",
            reason: "Hard limits I cannot violate — tech stack constraints, scale assumptions, etc.",
          },
        ],
      },
    ],
  },

  {
    id: "fix-bug",
    name: "Fix a Bug",
    description: "Trace a reported bug through ingestion → distillation → brain pipeline",
    colorClass: "red",
    icon: "🐛",
    steps: [
      {
        action: "Check agent operating rules",
        thinking:
          "Before touching any code I read my own prompt — it tells me how to investigate bugs in this codebase and what patterns to follow.",
        files: [
          {
            id: "agents.coding_agent_prompt",
            title: "Coding Agent Prompt",
            relevance: "primary",
            reason: "Contains debugging methodology and constraints I must follow in this project",
          },
        ],
      },
      {
        action: "Orient in the system",
        thinking:
          "I need the overall picture first. If I don't know which subsystem owns the bug, I'll read the wrong code.",
        files: [
          {
            id: "architecture.system_overview",
            title: "System Overview",
            relevance: "primary",
            reason: "Identify which component owns the failing behavior",
          },
          {
            id: "architecture.runtime_flow",
            title: "Runtime Flow",
            relevance: "secondary",
            reason: "Trace the execution path — where is the bug most likely introduced?",
          },
        ],
      },
      {
        action: "Trace the ingestion pipeline",
        thinking:
          "Most bugs in this system occur at the boundaries — normalization, event creation, or distillation. I'll walk the ingestion path carefully.",
        files: [
          {
            id: "architecture.ingestion_pipeline",
            title: "Ingestion Pipeline",
            relevance: "primary",
            reason: "Step-by-step walkthrough of how events enter the system — where most bugs hide",
          },
          {
            id: "architecture.data_model",
            title: "Data Model",
            relevance: "primary",
            reason: "Type mismatches between pipeline stages often cause silent bugs",
          },
          {
            id: "architecture.distillation_pipeline",
            title: "Distillation Pipeline",
            relevance: "secondary",
            reason: "If bug is downstream, distillation is the next suspect",
          },
        ],
      },
      {
        action: "Check past decisions",
        thinking:
          "Bugs sometimes exist because of deliberate constraints or trade-offs made earlier. I check the decision log to avoid 'fixing' something that was intentional.",
        files: [
          {
            id: "decisions.decision_log",
            title: "Decision Log",
            relevance: "secondary",
            reason: "Prevents me from undoing intentional trade-offs that look like bugs",
          },
          {
            id: "decisions.ADR-0002-local-demo-fallbacks",
            title: "ADR-0002: Local Demo Fallbacks",
            relevance: "referenced",
            reason: "Many runtime differences are by design — this ADR explains local vs production behavior",
          },
        ],
      },
    ],
  },

  {
    id: "add-integration",
    name: "Add a New Integration",
    description: "Wire a new data source (webhook) into the ingestion pipeline",
    colorClass: "green",
    icon: "🔌",
    steps: [
      {
        action: "Understand system boundaries",
        thinking:
          "Adding an integration touches the ingestion layer, normalizers, and potentially the brain. I need the full picture first.",
        files: [
          {
            id: "architecture.system_overview",
            title: "System Overview",
            relevance: "primary",
            reason: "Shows where integrations plug into the pipeline and what contract they must satisfy",
          },
          {
            id: "architecture.ingestion_pipeline",
            title: "Ingestion Pipeline",
            relevance: "primary",
            reason: "Defines the exact interface I need to implement for the new normalizer",
          },
        ],
      },
      {
        action: "Study existing integrations",
        thinking:
          "I don't reinvent the wheel — I read what already exists to understand the pattern and copy the correct shape.",
        files: [
          {
            id: "integrations.github",
            title: "GitHub Integration",
            relevance: "primary",
            reason: "Reference implementation — I'll follow this exact shape for the new integration",
          },
          {
            id: "integrations.slack",
            title: "Slack Integration",
            relevance: "secondary",
            reason: "Second example to confirm the pattern is consistent across integrations",
          },
          {
            id: "integrations.meetings",
            title: "Meeting Transcript Integration",
            relevance: "referenced",
            reason: "Shows how non-standard sources (not webhooks) are handled",
          },
        ],
      },
      {
        action: "Review data model",
        thinking:
          "My normalizer must output a NormalizedEvent. I read the data model to ensure I produce exactly the right shape.",
        files: [
          {
            id: "architecture.data_model",
            title: "Data Model",
            relevance: "primary",
            reason: "NormalizedEvent is the contract — my normalizer must satisfy this type exactly",
          },
          {
            id: "summaries.architecture_summary",
            title: "Architecture Summary",
            relevance: "referenced",
            reason: "Sanity-check: does adding this integration fit the stated architecture goals?",
          },
        ],
      },
      {
        action: "Check decisions and constraints",
        thinking:
          "Before committing, I check whether there are any decisions or constraints that affect how I should build this.",
        files: [
          {
            id: "decisions.decision_log",
            title: "Decision Log",
            relevance: "secondary",
            reason: "Confirms no prior decision blocks or shapes this integration pattern",
          },
          {
            id: "context.constraints",
            title: "Constraints",
            relevance: "secondary",
            reason: "Verifies this integration doesn't violate tech stack or scale constraints",
          },
        ],
      },
    ],
  },

  {
    id: "build-feature",
    name: "Build a Feature",
    description: "Design and implement a new product capability end-to-end",
    colorClass: "purple",
    icon: "✨",
    steps: [
      {
        action: "Align with product goals",
        thinking:
          "Before writing a line of code I ask: is this feature aligned with the product direction? I read goals first.",
        files: [
          {
            id: "goals.product_goals",
            title: "Product Goals",
            relevance: "primary",
            reason: "Confirms the feature belongs in this product — prevents building the wrong thing",
          },
          {
            id: "summaries.project_summary",
            title: "Project Summary",
            relevance: "secondary",
            reason: "High-level product context — helps me frame the feature correctly",
          },
        ],
      },
      {
        action: "Understand the current system",
        thinking:
          "Now I need to understand what already exists so I know what to extend vs what to build from scratch.",
        files: [
          {
            id: "architecture.system_overview",
            title: "System Overview",
            relevance: "primary",
            reason: "Which components does my feature touch? Where does it plug in?",
          },
          {
            id: "architecture.runtime_flow",
            title: "Runtime Flow",
            relevance: "primary",
            reason: "Understanding the request lifecycle tells me where to hook in the feature",
          },
          {
            id: "architecture.data_model",
            title: "Data Model",
            relevance: "secondary",
            reason: "New features often need new types — I check existing types first to avoid duplication",
          },
        ],
      },
      {
        action: "Check constraints and open questions",
        thinking:
          "Before designing the implementation I check what constraints exist — I don't want to design something that can't be deployed.",
        files: [
          {
            id: "context.constraints",
            title: "Constraints",
            relevance: "primary",
            reason: "Hard limits that shape my implementation choices — I cannot ignore these",
          },
          {
            id: "context.open_questions",
            title: "Open Questions",
            relevance: "secondary",
            reason: "Unresolved questions may affect my design — better to know now than discover mid-implementation",
          },
        ],
      },
      {
        action: "Read decisions and agent prompt",
        thinking:
          "Finally I check the decision log for any prior decisions affecting my feature, and my own prompt to confirm I'm acting correctly.",
        files: [
          {
            id: "decisions.decision_log",
            title: "Decision Log",
            relevance: "secondary",
            reason: "Prior decisions may constrain or inform my implementation choices",
          },
          {
            id: "agents.coding_agent_prompt",
            title: "Coding Agent Prompt",
            relevance: "primary",
            reason: "My operating contract — I re-read it before implementing any significant feature",
          },
        ],
      },
    ],
  },

  {
    id: "code-review",
    name: "Code Review",
    description: "Review a pull request against architecture, decisions, and contracts",
    colorClass: "orange",
    icon: "🔍",
    steps: [
      {
        action: "Load review context",
        thinking:
          "I start a review by loading the decision log and agent prompt — these define the standard I'm reviewing against.",
        files: [
          {
            id: "agents.coding_agent_prompt",
            title: "Coding Agent Prompt",
            relevance: "primary",
            reason: "The coding standard — every PR must conform to the contract in this file",
          },
          {
            id: "decisions.decision_log",
            title: "Decision Log",
            relevance: "primary",
            reason: "Prior decisions are laws — if the PR violates one, it must be flagged",
          },
        ],
      },
      {
        action: "Check architectural conformance",
        thinking:
          "Does the PR change the component boundaries? Add new dependencies? I verify it conforms to the stated architecture.",
        files: [
          {
            id: "architecture.system_overview",
            title: "System Overview",
            relevance: "primary",
            reason: "Reference architecture — the PR must not introduce regressions or unauthorized patterns",
          },
          {
            id: "architecture.runtime_flow",
            title: "Runtime Flow",
            relevance: "secondary",
            reason: "Any change to request handling must be traced through the runtime flow",
          },
          {
            id: "architecture.data_model",
            title: "Data Model",
            relevance: "secondary",
            reason: "Type changes must be backward-compatible — I check the data model contract",
          },
        ],
      },
      {
        action: "Validate specific ADRs",
        thinking:
          "Some PRs touch specific ADR domains — I read the relevant ADRs to confirm the PR doesn't violate them.",
        files: [
          {
            id: "decisions.ADR-0001-git-backed-brain",
            title: "ADR-0001: Git-Backed Brain",
            relevance: "secondary",
            reason: "Any brain storage changes must go through git — this ADR defines that constraint",
          },
          {
            id: "decisions.ADR-0002-local-demo-fallbacks",
            title: "ADR-0002: Local Fallbacks",
            relevance: "referenced",
            reason: "Changes to env handling must preserve the local demo fallback behavior",
          },
          {
            id: "context.constraints",
            title: "Constraints",
            relevance: "referenced",
            reason: "Final check — does anything in the PR violate a hard constraint?",
          },
        ],
      },
    ],
  },

  {
    id: "perf-debug",
    name: "Performance Debug",
    description: "Investigate latency or throughput issues in the pipeline",
    colorClass: "cyan",
    icon: "⚡",
    steps: [
      {
        action: "Map the data flow",
        thinking:
          "Performance problems hide at boundaries. I map the full data flow first to identify every hop where latency could accumulate.",
        files: [
          {
            id: "architecture.runtime_flow",
            title: "Runtime Flow",
            relevance: "primary",
            reason: "Every step in this flow is a potential latency source — I read it in detail",
          },
          {
            id: "architecture.system_overview",
            title: "System Overview",
            relevance: "secondary",
            reason: "Shows component boundaries where I/O and network calls happen",
          },
        ],
      },
      {
        action: "Inspect the pipelines",
        thinking:
          "Ingestion and distillation are the two hot paths. I read them carefully to find N+1 queries, blocking calls, or unnecessary work.",
        files: [
          {
            id: "architecture.ingestion_pipeline",
            title: "Ingestion Pipeline",
            relevance: "primary",
            reason: "Hot path #1 — every webhook goes through this. A slow step here multiplies with traffic",
          },
          {
            id: "architecture.distillation_pipeline",
            title: "Distillation Pipeline",
            relevance: "primary",
            reason: "Hot path #2 — LLM calls and vector operations here are expensive",
          },
          {
            id: "architecture.brain_storage",
            title: "Brain Storage",
            relevance: "secondary",
            reason: "Brain reads/writes go through GitHub API or disk — both have latency characteristics",
          },
        ],
      },
      {
        action: "Check constraints and trade-offs",
        thinking:
          "Some slowness is intentional — the constraints file explains what trade-offs were accepted. I need to know what can and cannot be changed.",
        files: [
          {
            id: "context.constraints",
            title: "Constraints",
            relevance: "primary",
            reason: "Documents accepted trade-offs — some latency may be a deliberate product decision",
          },
          {
            id: "decisions.ADR-0002-local-demo-fallbacks",
            title: "ADR-0002: Local Fallbacks",
            relevance: "referenced",
            reason: "Local vs production performance profiles differ by design — confirmed here",
          },
          {
            id: "architecture.data_model",
            title: "Data Model",
            relevance: "referenced",
            reason: "Schema design affects query performance — checking for missing indexes or join patterns",
          },
        ],
      },
    ],
  },
];

export type HighlightEntry = { id: string; relevance: Relevance };

/** Given a scenario + step index, return all accumulated highlighted nodes */
export function getHighlightedNodes(
  scenario: Scenario,
  upToStep: number,
): Map<string, Relevance> {
  const map = new Map<string, Relevance>();
  for (let i = 0; i <= upToStep && i < scenario.steps.length; i++) {
    for (const file of scenario.steps[i].files) {
      // Don't downgrade: primary > secondary > referenced
      const existing = map.get(file.id);
      if (!existing || relevanceRank(file.relevance) > relevanceRank(existing)) {
        map.set(file.id, file.relevance);
      }
    }
  }
  return map;
}

function relevanceRank(r: Relevance): number {
  if (r === "primary") return 3;
  if (r === "secondary") return 2;
  return 1;
}
