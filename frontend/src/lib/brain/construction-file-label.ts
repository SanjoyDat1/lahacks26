/**
 * Human-readable labels for the session "construction" graph and file tree.
 * Disambiguates repeated basenames (e.g. many overview.md) using parent folders
 * and prefers YAML `title` / frontmatter when available.
 */

function humanizeSegment(s: string): string {
  const core = s.replace(/\.mdx?$/i, "");
  const spaced = core.replace(/_/g, " ").replace(/-/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Fast title extraction for agent markdown (no full YAML parser in hot path). */
export function parseFrontmatterTitle(content: string): string | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m?.[1]) return null;
  const block = m[1]!;
  for (const line of block.split(/\r?\n/)) {
    const t = /^\s*title:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(line);
    if (t) {
      const v = (t[1] ?? t[2] ?? t[3] ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

export function fileLabelForConstruction(
  path: string,
  opts?: { title?: string | null; content?: string | null },
): string {
  const fromContent = opts?.content ? parseFrontmatterTitle(opts.content) : null;
  const fromOpts = (opts?.title && String(opts.title).trim()) || null;
  const prefer = fromOpts || fromContent;

  const base =
    path
      .split("/")
      .pop()
      ?.replace(/\.mdx?$/i, "")
      .replace(/_/g, " ") ?? path;

  if (prefer) {
    const pNorm = prefer.toLowerCase().replace(/["'`]+/g, "").replace(/\s+/g, " ").trim();
    const bNorm = base.toLowerCase();
    if (pNorm && pNorm !== bNorm && !pNorm.endsWith(`.md`)) {
      return prefer.length > 44 ? `${prefer.slice(0, 42)}…` : prefer;
    }
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return path;
  if (parts.length === 1) {
    return humanizeSegment(parts[0]!);
  }
  const file = parts[parts.length - 1]!.replace(/\.mdx?$/i, "");
  const parent = parts[parts.length - 2]!;
  return `${humanizeSegment(parent)} · ${humanizeSegment(file)}`;
}
