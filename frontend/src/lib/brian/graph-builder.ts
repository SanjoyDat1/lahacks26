/**
 * Pure (no `node:fs`) graph construction.
 *
 * `reader.ts` was the historical home for both filesystem reading and graph
 * building, but the graph view now needs to render in the browser from the
 * live agent's `GET /files` payload. Anything that touches `node:fs` is kept
 * in `reader.ts`; anything safe to bundle for the client lives here.
 */

export type BrianFrontmatter = {
  id?: string;
  type?: string;
  title?: string;
  status?: string;
  importance?: "critical" | "high" | "medium" | "low";
  updated?: string;
  links?: string[];
  keywords?: string[];
};

export type BrianFile = {
  path: string;
  content: string;
  frontmatter: BrianFrontmatter;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  importance: string;
  path: string;
  val: number;
  keywords: string[];
};

export type GraphLink = {
  source: string;
  target: string;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

function importanceVal(imp?: string) {
  if (imp === "critical") return 9;
  if (imp === "high") return 6;
  if (imp === "medium") return 3;
  if (imp === "low") return 1;
  return 2;
}

function normPath(p: string) {
  return p.replace(/\\/g, "/").toLowerCase();
}

function resolveBrainHubs(files: BrianFile[]): {
  indexId: string | null;
  mapId: string | null;
  summaryId: string | null;
} {
  let indexId: string | null = null;
  let mapId: string | null = null;
  let summaryId: string | null = null;
  for (const f of files) {
    const id = f.frontmatter.id ?? f.path;
    const p = normPath(f.path);
    if (p === "index.md") indexId = id;
    else if (p.endsWith("/index.md") && !indexId) indexId = id;
    if (p === "map.md") mapId = id;
    else if (p.endsWith("/map.md") && !mapId) mapId = id;
    if (p === "summaries/project_summary.md" || p.endsWith("summaries/project_summary.md"))
      summaryId = id;
  }
  if (!indexId) {
    const hit = files.find(
      (f) => f.frontmatter.type === "index" || normPath(f.path).endsWith("/index.md"),
    );
    if (hit) indexId = hit.frontmatter.id ?? hit.path;
  }
  if (!mapId) {
    const hit = files.find((f) => f.frontmatter.type === "map");
    if (hit) mapId = hit.frontmatter.id ?? hit.path;
  }
  return { indexId, mapId, summaryId };
}

function collectProjectHubIds(files: BrianFile[]): string[] {
  const slugs = new Set<string>();
  for (const f of files) {
    const m = /^projects\/([^/]+)\//i.exec(f.path);
    if (m) slugs.add(m[1]!);
  }
  const hubs: string[] = [];
  for (const slug of [...slugs].sort((a, b) => a.localeCompare(b))) {
    const inProj = files.filter((f) =>
      new RegExp(`^projects/${slug}/`, "i").test(f.path),
    );
    const overview = inProj.find((f) => /(^|\/)overview\.md$/i.test(f.path));
    const pick = overview ?? [...inProj].sort((a, b) => a.path.localeCompare(b.path))[0];
    if (pick) hubs.push(pick.frontmatter.id ?? pick.path);
  }
  return hubs;
}

function enrichGraphConnectivity(
  nodes: GraphNode[],
  files: BrianFile[],
  links: GraphLink[],
  seen: Set<string>,
): void {
  const addLink = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}→${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target });
  };

  const { indexId, mapId, summaryId } = resolveBrainHubs(files);
  const projectHubIds = collectProjectHubIds(files);

  if (indexId) {
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const { source, target } of links) {
      adj.get(source)?.add(target);
      adj.get(target)?.add(source);
    }
    const reachable = new Set<string>();
    const stack = [indexId];
    while (stack.length) {
      const u = stack.pop()!;
      if (reachable.has(u)) continue;
      reachable.add(u);
      for (const v of adj.get(u) ?? []) stack.push(v);
    }
    for (const n of nodes) {
      if (n.id === indexId) continue;
      if (!reachable.has(n.id)) addLink(n.id, indexId);
    }
    if (mapId && mapId !== indexId) addLink(indexId, mapId);
    if (summaryId && summaryId !== indexId) addLink(indexId, summaryId);
    for (const hubId of projectHubIds) {
      if (hubId !== indexId) addLink(indexId, hubId);
    }
  }

  if (projectHubIds.length >= 2) {
    for (let i = 0; i < projectHubIds.length; i++) {
      const a = projectHubIds[i]!;
      const b = projectHubIds[(i + 1) % projectHubIds.length]!;
      addLink(a, b);
    }
  }

  if (mapId && summaryId && mapId !== summaryId) {
    addLink(mapId, summaryId);
    addLink(summaryId, mapId);
  }

  const otherPrefixes = new Map<string, BrianFile[]>();
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const top = parts[0]!.toLowerCase();
    if (top === "projects" || top === "summaries") continue;
    const prefix = `${parts[0]}/${parts[1]}`;
    if (!otherPrefixes.has(prefix)) otherPrefixes.set(prefix, []);
    otherPrefixes.get(prefix)!.push(f);
  }
  const otherHubIds: string[] = [];
  for (const [, group] of otherPrefixes) {
    const overview = group.find((f) => /(^|\/)overview\.md$/i.test(f.path));
    const pick = overview ?? [...group].sort((a, b) => a.path.localeCompare(b.path))[0];
    if (pick) otherHubIds.push(pick.frontmatter.id ?? pick.path);
  }
  otherHubIds.sort((a, b) => a.localeCompare(b));
  if (indexId && otherHubIds.length) {
    for (const hid of otherHubIds) {
      if (hid !== indexId) {
        addLink(hid, indexId);
        addLink(indexId, hid);
      }
    }
  }
  if (otherHubIds.length >= 2) {
    for (let i = 0; i < otherHubIds.length; i++) {
      addLink(otherHubIds[i]!, otherHubIds[(i + 1) % otherHubIds.length]!);
    }
  }
}

export function buildGraphData(files: BrianFile[]): GraphData {
  const nodes: GraphNode[] = files.map((f) => ({
    id: f.frontmatter.id ?? f.path,
    label:
      f.frontmatter.title ??
      f.path
        .split("/")
        .pop()
        ?.replace(".md", "")
        .replace(/_/g, " ") ??
      f.path,
    type: f.frontmatter.type ?? "unknown",
    importance: f.frontmatter.importance ?? "medium",
    path: f.path,
    val: importanceVal(f.frontmatter.importance),
    keywords: f.frontmatter.keywords ?? [],
  }));

  const seen = new Set<string>();
  const links: GraphLink[] = [];
  const byReference = new Map<string, BrianFile>();

  for (const file of files) {
    const id = file.frontmatter.id ?? file.path;
    const pathWithoutExtension = file.path.replace(/\.md$/, "");
    byReference.set(id, file);
    byReference.set(file.path, file);
    byReference.set(pathWithoutExtension, file);
    byReference.set(pathWithoutExtension.replace(/\//g, "."), file);
  }

  for (const file of files) {
    const sourceId = file.frontmatter.id ?? file.path;
    for (const link of file.frontmatter.links ?? []) {
      const target = byReference.get(link) ?? byReference.get(link.replace(/\.md$/, ""));
      if (!target) continue;
      const targetId = target.frontmatter.id ?? target.path;
      const key = `${sourceId}→${targetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: sourceId, target: targetId });
      }
    }
  }

  const byDir = new Map<string, BrianFile[]>();
  for (const file of files) {
    const dir = file.path.split("/").slice(0, -1).join("/") || "__root__";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(file);
  }
  for (const [, group] of byDir) {
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    for (let i = 0; i < sorted.length - 1; i++) {
      const sourceId = sorted[i]!.frontmatter.id ?? sorted[i]!.path;
      const targetId = sorted[i + 1]!.frontmatter.id ?? sorted[i + 1]!.path;
      const key = `${sourceId}→${targetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: sourceId, target: targetId });
      }
    }
  }

  enrichGraphConnectivity(nodes, files, links, seen);

  return { nodes, links };
}
