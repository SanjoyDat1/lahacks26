import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

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

const importanceOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function hasMarkdownFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && hasMarkdownFiles(full)) return true;
    if (stat.isFile() && entry.endsWith(".md")) return true;
  }
  return false;
}

export function resolveBrianDir(): string {
  if (process.env.BRAIN_DIR && hasMarkdownFiles(process.env.BRAIN_DIR)) {
    return process.env.BRAIN_DIR;
  }
  if (process.env.BRIAN_DIR && hasMarkdownFiles(process.env.BRIAN_DIR)) {
    return process.env.BRIAN_DIR;
  }

  const candidates = [
    path.join(process.cwd(), "brain"),
    path.join(process.cwd(), "..", "brain"),
    path.join(process.cwd(), "brian"),
    path.join(process.cwd(), "..", "brian"),
  ];
  return candidates.find(hasMarkdownFiles) ?? path.join(process.cwd(), "brain");
}

export function readBrianFiles(): BrianFile[] {
  const brianDir = resolveBrianDir();
  if (!fs.existsSync(brianDir)) return [];

  const files: BrianFile[] = [];
  collectMd(brianDir, brianDir, files);

  // Deduplicate by path to prevent React key errors
  const seen = new Set<string>();
  const uniqueFiles = files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });

  return uniqueFiles.sort((a, b) => {
    const ao = importanceOrder[a.frontmatter.importance ?? "medium"] ?? 2;
    const bo = importanceOrder[b.frontmatter.importance ?? "medium"] ?? 2;
    return ao - bo;
  });
}

function collectMd(baseDir: string, currentDir: string, out: BrianFile[]) {
  for (const entry of fs.readdirSync(currentDir)) {
    const full = path.join(currentDir, entry);
    if (fs.statSync(full).isDirectory()) {
      collectMd(baseDir, full, out);
    } else if (entry.endsWith(".md")) {
      const raw = fs.readFileSync(full, "utf8");
      const relativePath = path.relative(baseDir, full).replace(/\\/g, "/");
      const { data, content } = parseMarkdownFile(raw, relativePath);
      const fm = data as Record<string, unknown>;
      // gray-matter parses YYYY-MM-DD dates as Date objects; normalize to string
      if (fm.updated instanceof Date) {
        fm.updated = fm.updated.toISOString().slice(0, 10);
      }
      out.push({
        path: relativePath,
        content,
        frontmatter: fm as BrianFrontmatter,
      });
    }
  }
}

function parseMarkdownFile(raw: string, relativePath: string): { data: BrianFrontmatter; content: string } {
  try {
    return matter(raw) as { data: BrianFrontmatter; content: string };
  } catch {
    const fallback = fallbackMarkdownParse(raw, relativePath);
    return {
      data: fallback.frontmatter,
      content: fallback.content,
    };
  }
}

function fallbackMarkdownParse(raw: string, relativePath: string): { frontmatter: BrianFrontmatter; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const body = match ? raw.slice(match[0].length) : raw;
  const frontmatterBlock = match?.[1] ?? "";
  const frontmatter: BrianFrontmatter = {
    id: relativePath.replace(/\.md$/, "").replace(/\//g, "."),
    title: titleFromPath(relativePath),
    type: relativePath.split("/")[0] || "note",
    importance: "medium",
    links: [],
    keywords: [],
  };

  for (const line of frontmatterBlock.split(/\r?\n/)) {
    const normalized = line.trim();
    if (!normalized || normalized.startsWith("- ")) continue;
    const separator = normalized.indexOf(":");
    if (separator === -1) continue;
    const key = normalized.slice(0, separator).trim();
    const value = normalized.slice(separator + 1).trim();
    if (!value) continue;
    if (key === "links" || key === "keywords") {
      frontmatter[key] = parseInlineList(value);
    } else if (key === "importance") {
      const importance = value.replace(/^['"]|['"]$/g, "");
      if (["critical", "high", "medium", "low"].includes(importance)) {
        frontmatter.importance = importance as BrianFrontmatter["importance"];
      }
    } else if (key === "id" || key === "type" || key === "title" || key === "status" || key === "updated") {
      frontmatter[key] = value.replace(/^['"]|['"]$/g, "");
    }
  }

  return { frontmatter, content: body };
}

function parseInlineList(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function titleFromPath(relativePath: string) {
  return (
    relativePath
      .split("/")
      .pop()
      ?.replace(/\.md$/, "")
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()) ?? relativePath
  );
}

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

/** One representative node per `projects/<slug>/` (prefer overview.md). */
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

/**
 * Ensures the force graph is query-useful: hub-and-spoke + folder chains +
 * cross-project "cousin" links so no cluster floats alone.
 */
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
      adj.get(source)!.add(target);
      adj.get(target)!.add(source);
    }
    const reachable = new Set<string>();
    const stack = [indexId];
    while (stack.length) {
      const u = stack.pop()!;
      if (reachable.has(u)) continue;
      reachable.add(u);
      for (const v of adj.get(u) ?? []) stack.push(v);
    }
    // Attach any island to the index (feeds into the brain)
    for (const n of nodes) {
      if (n.id === indexId) continue;
      if (!reachable.has(n.id)) addLink(n.id, indexId);
    }
    // Strong spine: index → map, summary, each project hub
    if (mapId && mapId !== indexId) addLink(indexId, mapId);
    if (summaryId && summaryId !== indexId) addLink(indexId, summaryId);
    for (const hubId of projectHubIds) {
      if (hubId !== indexId) addLink(indexId, hubId);
    }
  }

  // Cousin ring: project hubs see each other (distant related context)
  if (projectHubIds.length >= 2) {
    for (let i = 0; i < projectHubIds.length; i++) {
      const a = projectHubIds[i]!;
      const b = projectHubIds[(i + 1) % projectHubIds.length]!;
      addLink(a, b);
    }
  }

  // Map ↔ summary (orientation layer)
  if (mapId && summaryId && mapId !== summaryId) {
    addLink(mapId, summaryId);
    addLink(summaryId, mapId);
  }

  // Other top-level folders (people/, requirements/, …): link folder hub → index + weak ring
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

  // Intra-folder chain (sorted paths) so siblings stay tightly coupled
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
