/**
 * Preview layout while GitHub POST /initialize runs.
 * Mirrors a **thorough** division tree: hub + nested folders + platform spine.
 */

import { fileLabelForConstruction } from "@/lib/brain/construction-file-label";

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

/** All planned paths, then a map of path → interlinks for the construction graph. */
function divisionScaffold(
  slug: string,
): { paths: string[]; links: Map<string, string[]> } {
  const p = `divisions/${slug}`;
  const paths = [
    "index.md",
    "map.md",
    "summaries/project_summary.md",
    // Division hub (layer 1)
    `${p}/overview.md`,
    `${p}/architecture.md`,
    `${p}/data_model.md`,
    `${p}/timeline.md`,
    `${p}/open_questions.md`,
    `${p}/todos.md`,
    `${p}/risks.md`,
    `${p}/metrics.md`,
    // Nested layers (2+ path segments under division)
    `${p}/delivery/milestones.md`,
    `${p}/delivery/dependencies.md`,
    `${p}/people/team.md`,
    `${p}/people/oncall.md`,
    `${p}/notes/capture.md`,
    `${p}/integrations/surface.md`,
    "architecture/system_context.md",
    "decisions/ADR-0001-direction.md",
    "decisions/ADR-0002-stack.md",
    "integrations/github.md",
  ];

  const L = (path: string, to: string[]) => [path, to] as const;
  const hub: (readonly [string, string[]])[] = [
    L("index.md", [
      "map.md",
      "summaries/project_summary.md",
      `${p}/overview.md`,
    ]),
    L("map.md", [
      "index.md",
      `${p}/overview.md`,
      `${p}/architecture.md`,
    ]),
    L("summaries/project_summary.md", [
      "index.md",
      "map.md",
      `${p}/overview.md`,
    ]),
    L(`${p}/overview.md`, [
      "index.md",
      "map.md",
      "summaries/project_summary.md",
      `${p}/architecture.md`,
      `${p}/data_model.md`,
      `${p}/timeline.md`,
      `${p}/todos.md`,
      `${p}/delivery/milestones.md`,
      "integrations/github.md",
    ]),
    L(`${p}/architecture.md`, [
      `${p}/overview.md`,
      `${p}/data_model.md`,
      "architecture/system_context.md",
      `${p}/delivery/dependencies.md`,
    ]),
    L(`${p}/data_model.md`, [
      `${p}/overview.md`,
      `${p}/architecture.md`,
      "architecture/system_context.md",
    ]),
    L(`${p}/timeline.md`, [
      `${p}/overview.md`,
      `${p}/delivery/milestones.md`,
      "decisions/ADR-0001-direction.md",
    ]),
    L(`${p}/open_questions.md`, [
      `${p}/overview.md`,
      `${p}/timeline.md`,
      "decisions/ADR-0002-stack.md",
    ]),
    L(`${p}/todos.md`, [
      `${p}/overview.md`,
      `${p}/delivery/milestones.md`,
      `${p}/risks.md`,
    ]),
    L(`${p}/risks.md`, [`${p}/overview.md`, `${p}/todos.md`, `${p}/metrics.md`]),
    L(`${p}/metrics.md`, [`${p}/overview.md`, `${p}/delivery/milestones.md`]),
    L(`${p}/delivery/milestones.md`, [
      `${p}/overview.md`,
      `${p}/delivery/dependencies.md`,
      `${p}/timeline.md`,
    ]),
    L(`${p}/delivery/dependencies.md`, [
      `${p}/overview.md`,
      `${p}/delivery/milestones.md`,
      `${p}/architecture.md`,
    ]),
    L(`${p}/people/team.md`, [
      `${p}/overview.md`,
      `${p}/people/oncall.md`,
      `${p}/notes/capture.md`,
    ]),
    L(`${p}/people/oncall.md`, [
      `${p}/people/team.md`,
      `${p}/overview.md`,
      `${p}/risks.md`,
    ]),
    L(`${p}/notes/capture.md`, [
      `${p}/overview.md`,
      `${p}/open_questions.md`,
      "summaries/project_summary.md",
    ]),
    L(`${p}/integrations/surface.md`, [
      `${p}/overview.md`,
      "integrations/github.md",
      `${p}/architecture.md`,
    ]),
    L("architecture/system_context.md", [
      "index.md",
      `${p}/architecture.md`,
      "decisions/ADR-0001-direction.md",
    ]),
    L("decisions/ADR-0001-direction.md", [
      "index.md",
      `${p}/open_questions.md`,
      "decisions/ADR-0002-stack.md",
    ]),
    L("decisions/ADR-0002-stack.md", [
      "decisions/ADR-0001-direction.md",
      `${p}/architecture.md`,
    ]),
    L("integrations/github.md", [
      `${p}/overview.md`,
      "index.md",
      `${p}/integrations/surface.md`,
    ]),
  ];

  return { paths, links: new Map(hub.map(([a, b]) => [a, b])) };
}

/**
 * ~24 ghost nodes: shared spine + one multi-layer `divisions/<slug>/` tree.
 * Used only for animation while the real agent plan streams in.
 */
export function buildGhostScaffoldFiles(slug: string): GhostBrainFile[] {
  const { paths, links } = divisionScaffold(slug);
  return paths.map((path) => ({
    path,
    title: fileLabelForConstruction(path, {}),
    status: "planned" as const,
    isGhost: true,
    links: links.get(path),
  }));
}

export function chunkGhostBatches(files: GhostBrainFile[], size = 4): GhostBrainFile[][] {
  const batches: GhostBrainFile[][] = [];
  for (let i = 0; i < files.length; i += size) {
    batches.push(files.slice(i, i + size));
  }
  return batches;
}
