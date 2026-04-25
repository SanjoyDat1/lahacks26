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

function resolveBrianDir(): string {
  // Support BRIAN_DIR env var override
  if (process.env.BRIAN_DIR) return process.env.BRIAN_DIR;
  // Running from repo root (next dev from /lahacks26)
  const direct = path.join(process.cwd(), "brian");
  if (fs.existsSync(direct)) return direct;
  // Running from frontend/ subdirectory
  const up = path.join(process.cwd(), "..", "brian");
  if (fs.existsSync(up)) return up;
  return direct;
}

export function readBrianFiles(): BrianFile[] {
  const brianDir = resolveBrianDir();
  if (!fs.existsSync(brianDir)) return [];

  const files: BrianFile[] = [];
  collectMd(brianDir, brianDir, files);

  return files.sort((a, b) => {
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
      const { data, content } = matter(raw);
      const fm = data as Record<string, unknown>;
      // gray-matter parses YYYY-MM-DD dates as Date objects; normalize to string
      if (fm.updated instanceof Date) {
        fm.updated = fm.updated.toISOString().slice(0, 10);
      }
      out.push({
        path: path.relative(baseDir, full).replace(/\\/g, "/"),
        content,
        frontmatter: fm as BrianFrontmatter,
      });
    }
  }
}

function importanceVal(imp?: string) {
  if (imp === "critical") return 9;
  if (imp === "high") return 6;
  if (imp === "medium") return 3;
  if (imp === "low") return 1;
  return 2;
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

  for (const file of files) {
    const sourceId = file.frontmatter.id ?? file.path;
    for (const link of file.frontmatter.links ?? []) {
      const target = files.find((f) => f.frontmatter.id === link);
      if (!target) continue;
      const targetId = target.frontmatter.id ?? target.path;
      const key = `${sourceId}→${targetId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ source: sourceId, target: targetId });
      }
    }
  }

  return { nodes, links };
}
