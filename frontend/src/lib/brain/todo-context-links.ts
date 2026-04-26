/**
 * Extra graph edges for division `todos.md` (beyond `links` in frontmatter,
 * which are applied in the main graph builder): `context_links` in frontmatter
 * and inline `[label](path)` in the body (YAML block stripped; image links skipped).
 */

import type { BrianFile } from "@/lib/brian/graph-builder";
import {
  buildBrianPathLookup,
  isExternalOrNonBrainHref,
  resolveBrainLinkHref,
} from "@/lib/brian/resolve-markdown-link";

/** Paths like `todos.md` or `divisions/eng/todos.md`. */
export function isTodosMarkdownFile(path: string): boolean {
  return /(^|\/)todos\.md$/i.test(path.replace(/\\/g, "/").trim());
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/m, "").trimStart();
}

function resolveLinkString(
  raw: string,
  sourcePath: string,
  lookup: Map<string, BrianFile>,
): BrianFile | null {
  const t = raw.trim();
  if (!t) return null;
  return (
    lookup.get(t) ??
    lookup.get(t.toLowerCase()) ??
    resolveBrainLinkHref(t, sourcePath, lookup) ??
    resolveBrainLinkHref(t.replace(/^\.\//, ""), sourcePath, lookup)
  );
}

const MD_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Hrefs from `![alt](u)` (images) and bare URLs are ignored.
 */
function linkTargetsFromMarkdownBody(body: string, sourcePath: string, lookup: Map<string, BrianFile>): BrianFile[] {
  const out: BrianFile[] = [];
  const seen = new Set<string>();
  const push = (f: BrianFile | null) => {
    if (!f) return;
    if (seen.has(f.path)) return;
    seen.add(f.path);
    out.push(f);
  };

  for (const m of body.matchAll(MD_LINK)) {
    const idx = m.index ?? 0;
    if (idx > 0 && body[idx - 1] === "!") {
      continue;
    }
    const href = (m[2] ?? "").trim();
    if (!href || isExternalOrNonBrainHref(href)) continue;
    const hit = resolveBrainLinkHref(href, sourcePath, lookup);
    push(hit);
  }

  const WIKI = /\[\[([^\]]+)]\]/g;
  for (const m of body.matchAll(WIKI)) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    const href = /\.[a-z]+$/i.test(raw) ? raw : `${raw}.md`;
    if (isExternalOrNonBrainHref(href)) continue;
    push(resolveBrainLinkHref(href, sourcePath, lookup));
  }

  return out;
}

type FM = { context_links?: string[] };

/**
 * Additional brain files to wire from a `todos.md` node (`context_links` + body).
 * Standard `links` are handled by the main edge pass. Non-todo files return [].
 */
export function collectTodoContextLinkTargets(
  file: BrianFile,
  allFiles: BrianFile[],
): BrianFile[] {
  if (!isTodosMarkdownFile(file.path)) {
    return [];
  }

  const lookup = buildBrianPathLookup(allFiles);
  const fm = file.frontmatter as FM;
  const out: BrianFile[] = [];
  const seen = new Set<string>();
  const push = (b: BrianFile | null) => {
    if (!b) return;
    if (b.path === file.path) return;
    if (seen.has(b.path)) return;
    seen.add(b.path);
    out.push(b);
  };

  for (const s of fm.context_links ?? []) {
    push(resolveLinkString(s, file.path, lookup));
  }

  const body = stripFrontmatter(file.content);
  for (const t of linkTargetsFromMarkdownBody(body, file.path, lookup)) {
    push(t);
  }

  return out;
}
