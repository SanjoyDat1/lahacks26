/**
 * Human-readable labels for Brian files in graph + nav when many pages share
 * the same basename (overview.md) or a generic frontmatter title ("Overview").
 */

const GENERIC_STEMS = new Set([
  "overview",
  "readme",
  "index",
  "notes",
  "doc",
  "summary",
  "introduction",
  "getting-started",
  "guide",
]);

export type LabelableBrainFile = {
  path: string;
  frontmatter: { title?: string };
};

function pathParts(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function basenameStem(path: string): string {
  const parts = pathParts(path);
  const last = parts[parts.length - 1] ?? path;
  return last.replace(/\.mdx?$/i, "");
}

function humanizeSegment(segment: string): string {
  const core = segment.replace(/\.mdx?$/i, "");
  const spaced = core.replace(/_/g, " ").replace(/-/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function norm(s: string): string {
  return s.toLowerCase().replace(/["'`]+/g, "").replace(/\s+/g, " ").trim();
}

/** Up to the last three directory segments, e.g. `Company · Engineering`. */
function pathContextHint(path: string): string {
  const parts = pathParts(path);
  if (parts.length < 2) return "";
  const dirs = parts.slice(0, -1);
  const tail = dirs.slice(-3);
  return tail.map((s) => humanizeSegment(s)).join(" · ");
}

/**
 * Stable label for one file given the full workspace (collision-aware).
 */
export function uniqueBrainFileLabel(
  file: LabelableBrainFile,
  allFiles: LabelableBrainFile[],
): string {
  const parts = pathParts(file.path);
  const stem = basenameStem(file.path);
  const stemNorm = norm(stem);
  const titleRaw = file.frontmatter.title?.trim() ?? "";

  const primaryKey = titleRaw ? norm(titleRaw) : stemNorm;
  const collisionCount = allFiles.filter((f) => {
    const t = f.frontmatter.title?.trim() ?? "";
    const k = t ? norm(t) : norm(basenameStem(f.path));
    return k === primaryKey;
  }).length;

  const basenameCollision = allFiles.filter(
    (f) => norm(basenameStem(f.path)) === stemNorm,
  ).length;

  const hasFolder = parts.length >= 2;
  const genericStem = GENERIC_STEMS.has(stemNorm);
  const genericTitle = Boolean(titleRaw) && GENERIC_STEMS.has(norm(titleRaw));

  const needsContext =
    basenameCollision > 1 ||
    collisionCount > 1 ||
    (hasFolder && genericStem) ||
    (hasFolder && Boolean(titleRaw) && genericTitle);

  const titleDiffersFromStem = Boolean(titleRaw) && norm(titleRaw) !== stemNorm;

  if (!needsContext) {
    if (titleRaw) return titleRaw.length > 52 ? `${titleRaw.slice(0, 50)}…` : titleRaw;
    return humanizeSegment(stem);
  }

  const ctx = pathContextHint(file.path);
  const namePart =
    titleRaw && titleDiffersFromStem && !genericTitle
      ? titleRaw
      : humanizeSegment(stem);
  if (!ctx) {
    return namePart.length > 52 ? `${namePart.slice(0, 50)}…` : namePart;
  }
  const combined = `${ctx} · ${namePart}`;
  return combined.length > 60 ? `${combined.slice(0, 58)}…` : combined;
}

export function uniqueBrainFileLabels(
  allFiles: LabelableBrainFile[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of allFiles) {
    m.set(f.path, uniqueBrainFileLabel(f, allFiles));
  }
  return m;
}
