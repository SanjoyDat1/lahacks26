import { readBrain, writeBrainFile } from "@/lib/brain/provider";
import { createBrainUpdate, createDocument, updateEventStatus } from "@/lib/db/store";
import { completeJson, embedText } from "@/lib/llm/client";
import type { BrainFile, StoredEvent } from "@/lib/types";
import { truncate } from "@/lib/utils";

type Significance = {
  significant: boolean;
  significance: "high" | "medium" | "low" | "none";
  rationale: string;
  files: string[];
  update: {
    path: string;
    entry: string;
  };
};

const decisionKeywords = [
  "architecture",
  "decision",
  "goal",
  "constraint",
  "scope",
  "requirement",
  "launch",
  "security",
  "database",
  "api",
  "agent",
  "must",
  "should",
  "we decided",
  "blocker",
];

export async function distillEvent(event: StoredEvent) {
  const canonicalText = formatEventForBrain(event);
  const embedding = await embedText(canonicalText);

  await createDocument({
    eventId: event.id,
    source: event.source,
    text: canonicalText,
    sourceUrl: event.sourceUrl,
    embedding,
  });

  const brain = await readBrain();
  const fallback = heuristicSignificance(event);
  const significance = await completeJson<Significance>(
    `Given the current brain and this new event, decide whether the event changes goals, architecture, decisions, constraints, risks, or open questions.

Return JSON:
{
  "significant": boolean,
  "significance": "high" | "medium" | "low" | "none",
  "rationale": "short reason",
  "files": ["brain/file.md"],
  "update": {"path": "brain/decision_log.md", "entry": "markdown entry to append"}
}

Current brain:
${brain.map((file) => `--- ${file.path}\n${truncate(file.content, 1500)}`).join("\n\n")}

New event:
${canonicalText}`,
    fallback,
  );

  if (!significance.significant) {
    await updateEventStatus(event.id, {
      status: "ignored",
      significance: "none",
      distillerSummary: significance.rationale,
    });
    return undefined;
  }

  const targetPath = sanitizeBrainPath(significance.update.path || "brain/decision_log.md");
  const existing = brain.find((file) => file.path === targetPath) ?? ({ path: targetPath, content: "" } satisfies BrainFile);
  const entry = significance.update.entry?.trim() || buildDecisionEntry(event, significance.rationale);
  const content = `${existing.content.trim()}\n\n${entry}\n`;
  const commit = await writeBrainFile({
    path: targetPath,
    content,
    message: `brain: update ${targetPath.replace("brain/", "")} from ${event.source} event`,
  });

  const update = await createBrainUpdate({
    eventId: event.id,
    status: "applied",
    rationale: significance.rationale,
    changedFiles: [targetPath],
    commitSha: commit.sha,
    diffSummary: `Appended distilled context from ${event.source} event "${event.title}" to ${targetPath}.`,
  });

  await updateEventStatus(event.id, {
    status: "processed",
    significance: significance.significance,
    distillerSummary: significance.rationale,
  });

  return update;
}

function heuristicSignificance(event: StoredEvent): Significance {
  const text = `${event.title}\n${event.body}`.toLowerCase();
  const matches = decisionKeywords.filter((keyword) => text.includes(keyword));
  const significant = matches.length > 0 || event.source === "meetings";

  return {
    significant,
    significance: significant ? (matches.length > 2 ? "high" : "medium") : "none",
    rationale: significant
      ? `Detected durable context keywords: ${matches.slice(0, 5).join(", ") || "meeting transcript"}.`
      : "No durable project context detected.",
    files: significant ? ["brain/decision_log.md"] : [],
    update: {
      path: "brain/decision_log.md",
      entry: buildDecisionEntry(event, significant ? `Detected ${matches.length || 1} durable context signal(s).` : ""),
    },
  };
}

function buildDecisionEntry(event: StoredEvent, rationale: string) {
  const source = event.sourceUrl ? `[${event.source}](${event.sourceUrl})` : event.source;

  return `## ${new Date().toISOString().slice(0, 10)} - ${event.title}

- Source: ${source}
- Actor: ${event.actor ?? "unknown"}
- Rationale: ${rationale}
- Context: ${truncate(event.body.replace(/\s+/g, " "), 500)}
`;
}

function formatEventForBrain(event: StoredEvent) {
  return `Source: ${event.source}
Type: ${event.eventType}
Actor: ${event.actor ?? "unknown"}
Repository: ${event.repository ?? "n/a"}
Channel: ${event.channel ?? "n/a"}
Title: ${event.title}
URL: ${event.sourceUrl ?? "n/a"}

${event.body}`;
}

function sanitizeBrainPath(path: string) {
  if (!path.startsWith("brain/") || !path.endsWith(".md")) return "brain/decision_log.md";
  return path;
}
