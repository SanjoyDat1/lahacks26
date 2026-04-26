/**
 * Small preview layout while GitHub POST /initialize runs.
 * Matches the agent goal: one coherent project hub + shared spine, not a template zoo.
 */

export type GhostBrainFile = {
  path: string;
  title?: string;
  preview?: string;
  status: "planned" | "writing" | "done";
  links?: string[];
  isGhost?: boolean;
};

export function parseRepoSlugFromUrl(url: string): string {
  const m = url.trim().match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) return "project";
  return m[2].replace(/\.git$/i, "").toLowerCase().replace(/[^a-z0-9-_]/gi, "-").slice(0, 48) || "project";
}

function linkHub(paths: string[]): Pick<GhostBrainFile, "path" | "links" | "isGhost">[] {
  const [index, map, summary, overview, arch, timeline, sys, adr1, adr2] = paths;
  return [
    { path: index, links: [map, summary, overview].filter(Boolean) as string[], isGhost: true },
    { path: map, links: [index, overview].filter(Boolean) as string[], isGhost: true },
    { path: summary, links: [index, map].filter(Boolean) as string[], isGhost: true },
    { path: overview, links: [index, arch, timeline, sys].filter(Boolean) as string[], isGhost: true },
    { path: arch, links: [overview, sys, adr1].filter(Boolean) as string[], isGhost: true },
    { path: timeline, links: [overview, adr2].filter(Boolean) as string[], isGhost: true },
    { path: sys, links: [arch, overview].filter(Boolean) as string[], isGhost: true },
    { path: adr1, links: [overview, adr2].filter(Boolean) as string[], isGhost: true },
    { path: adr2, links: [adr1, arch].filter(Boolean) as string[], isGhost: true },
  ];
}

/** ~12 nodes, ≤6 top-level directory buckets in the live graph. */
export function buildGhostScaffoldFiles(slug: string): GhostBrainFile[] {
  const p = `projects/${slug}`;
  const paths = [
    "index.md",
    "map.md",
    "summaries/project_summary.md",
    `${p}/overview.md`,
    `${p}/architecture.md`,
    `${p}/data_model.md`,
    `${p}/timeline.md`,
    `${p}/open_questions.md`,
    "architecture/system_context.md",
    "decisions/ADR-0001-direction.md",
    "decisions/ADR-0002-stack.md",
    "integrations/github.md",
  ];

  const hub = linkHub([
    "index.md",
    "map.md",
    "summaries/project_summary.md",
    `${p}/overview.md`,
    `${p}/architecture.md`,
    `${p}/timeline.md`,
    "architecture/system_context.md",
    "decisions/ADR-0001-direction.md",
    "decisions/ADR-0002-stack.md",
  ]);
  const hubByPath = new Map<string, string[]>(hub.map((h) => [h.path, h.links ?? []]));
  hubByPath.set(`${p}/data_model.md`, [`${p}/architecture.md`, `${p}/overview.md`, "architecture/system_context.md"]);
  hubByPath.set(`${p}/open_questions.md`, [`${p}/overview.md`, `${p}/timeline.md`, "decisions/ADR-0001-direction.md"]);
  hubByPath.set("integrations/github.md", [`${p}/overview.md`, "index.md"]);

  return paths.map((path) => ({
    path,
    title: path.split("/").pop(),
    status: "planned" as const,
    isGhost: true,
    links: hubByPath.get(path),
  }));
}

export function chunkGhostBatches(files: GhostBrainFile[], size = 4): GhostBrainFile[][] {
  const batches: GhostBrainFile[][] = [];
  for (let i = 0; i < files.length; i += size) {
    batches.push(files.slice(i, i + size));
  }
  return batches;
}
