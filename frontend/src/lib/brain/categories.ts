export const CATEGORY_SHADES = {
  architecture: "#a78bfa", // violet-400
  decisions: "#8b5cf6",    // violet-500
  summaries: "#c4b5fd",    // violet-300
  integrations: "#7c3aed", // violet-600
  agents: "#6d28d9",       // violet-700
  context: "#ddd6fe",      // violet-200
  goals: "#f0abfc",        // fuchsia-300
  index: "#e9d5ff",        // violet-200-ish
  other: "#8b8fa0",        // cool gray
} as const;

export type BrainCategory = keyof typeof CATEGORY_SHADES;

export function categoryOf(p: string): BrainCategory {
  const path = (p ?? "").replace(/^\/+/, "").trim();
  if (!path) return "other";
  const seg0 = path.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  if (!seg0) return "other";
  if (seg0 in CATEGORY_SHADES) return seg0 as BrainCategory;
  // For top-level markdown files like `index.md` / `map.md`.
  if (!path.includes("/")) return "index";
  return "other";
}

export function categoryShade(p: string): string {
  return CATEGORY_SHADES[categoryOf(p)] ?? CATEGORY_SHADES.other;
}

