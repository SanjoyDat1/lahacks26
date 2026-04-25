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

  for (const file of files) {
    const sourceId = file.frontmatter.id ?? file.path;
    const sourceDir = file.path.split("/").slice(0, -1).join("/");
    if (!sourceDir) continue;
    for (const sibling of files) {
      if (sibling.path === file.path) continue;
      const siblingDir = sibling.path.split("/").slice(0, -1).join("/");
      if (siblingDir !== sourceDir) continue;
      const targetId = sibling.frontmatter.id ?? sibling.path;
      const key = `${sourceId}→${targetId}`;
      const reverseKey = `${targetId}→${sourceId}`;
      if (!seen.has(key) && !seen.has(reverseKey)) {
        seen.add(key);
        links.push({ source: sourceId, target: targetId });
        break;
      }
    }
  }

  return { nodes, links };
}
