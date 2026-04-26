/**
 * Company → division → file model for the Brian graph and filter chips.
 *
 * Division keys (stable ids for toggles):
 * - q:org     — top-level / company-wide docs (index.md, map.md, etc.)
 * - q:shared  — cross-team platform dirs (summaries, decisions, architecture, …)
 * - d:<slug>  — divisions/<slug>/**
 * - c:<slug>  — company/<slug>/**  (common in distiller output)
 * - p:<slug>  — projects/<slug>/**
 * - m:<slug>  — any other top-level tree (misc bucket for filtering)
 */

export type PathFile = { path: string };

const SHARED_ROOTS = new Set([
  "summaries",
  "decisions",
  "architecture",
  "integrations",
  "context",
  "goals",
  "agents",
  "governance",
]);

const PALETTE = [
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#0ea5e9",
  "#ec4899",
  "#22c55e",
  "#6366f1",
  "#eab308",
  "#a855f7",
  "#06b6d4",
];

function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function divisionKeyForPath(path: string): string {
  const p = (path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segs = p.split("/").filter(Boolean);
  if (segs.length === 0) return "q:shared";
  if (segs.length === 1) return "q:org";
  const top = segs[0]!.toLowerCase();
  if (top === "divisions" && segs[1]) return `d:${segs[1]!.toLowerCase()}`;
  if (top === "company" && segs[1]) return `c:${segs[1]!.toLowerCase()}`;
  if (top === "projects" && segs[1]) return `p:${segs[1]!.toLowerCase()}`;
  if (SHARED_ROOTS.has(top)) return "q:shared";
  return `m:${top.toLowerCase()}`;
}

function humanizeSlug(slug: string): string {
  const s = slug.replace(/_/g, " ").replace(/-/g, " ");
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function labelForDivisionKey(key: string): string {
  if (key === "q:org") return "Company";
  if (key === "q:shared") return "Platform";
  if (key.startsWith("d:")) return `Division · ${humanizeSlug(key.slice(2))}`;
  if (key.startsWith("c:")) return `Company · ${humanizeSlug(key.slice(2))}`;
  if (key.startsWith("p:")) return `Project · ${humanizeSlug(key.slice(2))}`;
  if (key.startsWith("m:")) return humanizeSlug(key.slice(2));
  return key;
}

export function tintForDivisionKey(key: string): string {
  if (key === "q:org") return "#a5b4fc";
  if (key === "q:shared") return "#c4b5fd";
  return PALETTE[hash32(key) % PALETTE.length]!;
}

export type DivisionFilterOption = {
  id: string;
  label: string;
  tint: string;
};

/**
 * Toggles to show: one per division key that has at least one file, ordered
 * for scannability (company → platform → the rest A–Z).
 */
export function listDivisionFilterOptions(files: PathFile[]): DivisionFilterOption[] {
  const keys = new Set<string>();
  for (const f of files) keys.add(divisionKeyForPath(f.path));
  const list = [...keys];
  const rank = (k: string) => (k === "q:org" ? 0 : k === "q:shared" ? 1 : 2);
  list.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.localeCompare(b, "en");
  });
  return list.map((id) => ({
    id,
    label: labelForDivisionKey(id),
    tint: tintForDivisionKey(id),
  }));
}

/**
 * Picks a hub file path per division key (for graph emphasis + spokes).
 * Returns `null` if the key has no files.
 */
export function pickHubPathForKey(files: PathFile[], key: string): string | null {
  const inKey = files.filter((f) => divisionKeyForPath(f.path) === key);
  if (inKey.length === 0) return null;

  const prefer = (re: RegExp) => inKey.find((f) => re.test(f.path));
  if (key === "q:org") {
    const pick =
      prefer(/(^|\/)index\.md$/i) ??
      inKey.find((f) => /^map\.md$/i.test(f.path)) ??
      [...inKey].sort((a, b) => a.path.localeCompare(b.path))[0];
    return pick?.path ?? null;
  }
  if (key === "q:shared") {
    return (
      prefer(/(^|\/)project_summary\.md$/i) ??
      prefer(/(^|\/)decision_log\.md$/i) ??
      prefer(/overview\.md$/i) ??
      [...inKey].sort((a, b) => a.path.localeCompare(b.path))[0]
    )?.path ?? null;
  }
  if (key.startsWith("d:") || key.startsWith("c:") || key.startsWith("p:") || key.startsWith("m:")) {
    return (
      prefer(/(^|\/)overview\.md$/i) ??
      prefer(/(^|\/)index\.md$/i) ??
      inKey.find((f) => f.path.toLowerCase().endsWith("/todos.md")) ??
      [...inKey].sort((a, b) => a.path.localeCompare(b.path))[0]
    )?.path ?? null;
  }
  return [...inKey].sort((a, b) => a.path.localeCompare(b.path))[0]?.path ?? null;
}

/**
 * If present, a lightweight checklist in `divisions/<div>/todos.md` (or
 * `company/.../todos.md`, `projects/.../todos.md`) for agents / humans.
 */
export function divisionTodosPathForKey(key: string): string | null {
  if (key.startsWith("d:")) return `divisions/${key.slice(2)}/todos.md`;
  if (key.startsWith("c:")) return `company/${key.slice(2)}/todos.md`;
  if (key.startsWith("p:")) return `projects/${key.slice(2)}/todos.md`;
  return null;
}
