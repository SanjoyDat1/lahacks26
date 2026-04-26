import type { BrianFile } from "@/lib/brian/reader";

/** Keys: path, path lowercased, id, path without .md, dot-style id (summaries.project_summary). */
export function buildBrianPathLookup(files: BrianFile[]): Map<string, BrianFile> {
  const map = new Map<string, BrianFile>();
  for (const f of files) {
    const id = f.frontmatter.id ?? f.path;
    const noExt = f.path.replace(/\.md$/i, "");
    const keys = new Set<string>([
      f.path,
      f.path.toLowerCase(),
      id,
      id.toLowerCase(),
      noExt,
      noExt.toLowerCase(),
      noExt.replace(/\//g, "."),
      noExt.replace(/\//g, ".").toLowerCase(),
    ]);
    for (const k of keys) {
      if (k) map.set(k, f);
    }
  }
  return map;
}

function normalizePathSegments(parts: string[]): string {
  const out: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** True when the markdown link should use normal browser navigation. */
export function isExternalOrNonBrainHref(href: string): boolean {
  const t = href.trim();
  if (!t || t === "#") return true;
  if (t.startsWith("#")) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.startsWith("mailto:")) return true;
  if (t.startsWith("//")) return true;
  if (t.startsWith("javascript:")) return true;
  return false;
}

/**
 * Map a markdown `href` to a brain file when it points at workspace Markdown.
 * Returns null for external URLs, hash-only links, or unknown paths.
 */
export function resolveBrainLinkHref(
  href: string,
  currentFilePath: string | null,
  lookup: Map<string, BrianFile>,
): BrianFile | null {
  const raw = href.trim();
  if (isExternalOrNonBrainHref(raw)) return null;

  const hashIdx = raw.indexOf("#");
  const pathPart = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).trim();
  if (!pathPart) return null;

  let candidate = pathPart;
  try {
    candidate = decodeURIComponent(pathPart);
  } catch {
    candidate = pathPart;
  }

  if (candidate.startsWith("/")) {
    candidate = candidate.replace(/^\/+/, "");
  }

  if (
    currentFilePath &&
    (candidate.startsWith("./") || candidate.startsWith("../") || candidate.startsWith("."))
  ) {
    const baseDir = currentFilePath.split("/").slice(0, -1);
    const relSegs = candidate.split("/").filter(Boolean);
    const merged = normalizePathSegments([...baseDir, ...relSegs]);
    candidate = merged;
  }

  const tryKeys = (key: string): BrianFile | null => {
    const k = key.trim();
    if (!k) return null;
    return (
      lookup.get(k) ??
      lookup.get(k.toLowerCase()) ??
      lookup.get(k.replace(/\.md$/i, "")) ??
      lookup.get(k.replace(/\.md$/i, "").toLowerCase()) ??
      null
    );
  };

  let hit = tryKeys(candidate);
  if (!hit && !/\.md$/i.test(candidate)) {
    hit = tryKeys(`${candidate}.md`);
  }

  // Same-directory relative link (e.g. `[map](map.md)` from `index.md`)
  if (!hit && currentFilePath && !candidate.includes("/") && !candidate.startsWith(".")) {
    const dir = currentFilePath.split("/").slice(0, -1).join("/");
    const inDir = dir ? `${dir}/${candidate}` : candidate;
    hit = tryKeys(inDir);
    if (!hit && !/\.md$/i.test(inDir)) {
      hit = tryKeys(`${inDir}.md`);
    }
  }

  return hit;
}
