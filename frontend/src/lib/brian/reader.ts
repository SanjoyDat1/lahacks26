import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import {
  buildGraphData,
  type BrianFile,
  type BrianFrontmatter,
  type GraphData,
  type GraphLink,
  type GraphNode,
} from "./graph-builder";

export type { BrianFile, BrianFrontmatter, GraphData, GraphLink, GraphNode };
export { buildGraphData };

const importanceOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Working brain on disk — must match the agent's default `BRAIN_DIR`
 * (`agent/brain_agents/config.py`: repo root `brain/`, not `agent/brain`).
 */
export function resolveBrianDir(): string {
  const fromEnv = process.env.BRAIN_DIR?.trim() || process.env.WORKING_BRAIN_DIR?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.resolve(process.cwd(), "..", "brain");
}

export function readBrianFiles(): BrianFile[] {
  const brianDir = resolveBrianDir();
  if (!fs.existsSync(brianDir)) return [];

  const files: BrianFile[] = [];
  collectMd(brianDir, brianDir, files);

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
    if (entry.startsWith(".")) continue;
    const full = path.join(currentDir, entry);
    if (fs.statSync(full).isDirectory()) {
      collectMd(baseDir, full, out);
    } else if (entry.endsWith(".md")) {
      const raw = fs.readFileSync(full, "utf8");
      const relativePath = path.relative(baseDir, full).replace(/\\/g, "/");
      const { data, content } = parseMarkdownFile(raw, relativePath);
      const fm = data as Record<string, unknown>;
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
