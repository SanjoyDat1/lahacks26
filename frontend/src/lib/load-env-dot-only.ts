import fs from "fs";
import path from "path";

/**
 * Minimal `.env` parser (no `.env.local`, `.env.development`, etc.).
 * Lines: `KEY=value`, optional quotes, `#` comments.
 */
export function parseDotEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Merge variables from each `{root}/.env` into `process.env`.
 * Later roots override earlier keys. Values from files win over prior `process.env`
 * for keys defined in that file.
 */
export function applyEnvDotFilesOnly(roots: readonly string[]): void {
  for (const root of roots) {
    const p = path.join(root, ".env");
    if (!fs.existsSync(p)) continue;
    const parsed = parseDotEnvFile(fs.readFileSync(p, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      process.env[k] = v;
    }
  }
}

/** Load only `.env`: monorepo root, then `frontend/` (same order as `next.config.ts`). */
export function applyMonorepoDotEnvFromFrontendPackage(frontendDir: string): void {
  applyEnvDotFilesOnly([path.resolve(frontendDir, ".."), frontendDir]);
}
