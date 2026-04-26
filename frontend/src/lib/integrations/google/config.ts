import path from "path";

import { applyEnvDotFilesOnly } from "../../load-env-dot-only";

export const GOOGLE_COOKIE_NAME = "google_workspace_session";
export const GOOGLE_STATE_COOKIE = "google_oauth_state";
export const GOOGLE_NEXT_COOKIE = "google_oauth_next";

/**
 * Ensure only `.env` (repo root + `frontend/`) is merged into `process.env` — not `.env.local`.
 * Re-applied at runtime so API routes / Turbopack always see the same `GOOGLE_*` as `next.config.ts`.
 */
let monorepoEnvLoaded = false;

/** Load `{repo}/.env` then `frontend/.env` into `process.env` (server runtime). */
export function loadGoogleWorkspaceEnvFromDisk(): void {
  if (monorepoEnvLoaded) return;
  monorepoEnvLoaded = true;
  const frontendDir = path.resolve(__dirname, "..", "..", "..", "..");
  applyEnvDotFilesOnly([path.resolve(frontendDir, ".."), frontendDir]);
}

/** Read-only Workspace coverage: Drive files, Docs, Sheets, Calendar. */
export const GOOGLE_WORKSPACE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export function googleIntegrationConfigured() {
  loadGoogleWorkspaceEnvFromDisk();
  const cookie = process.env.GOOGLE_COOKIE_SECRET?.trim() ?? "";
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      cookie.length >= 16,
  );
}

export function getGoogleCookieSecret(): string {
  loadGoogleWorkspaceEnvFromDisk();
  const s = process.env.GOOGLE_COOKIE_SECRET?.trim() ?? "";
  if (s.length < 16) {
    throw new Error("GOOGLE_COOKIE_SECRET must be set (min 16 characters)");
  }
  return s;
}

export function appBaseUrl(requestUrl: string) {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(requestUrl).origin).replace(/\/+$/, "");
}

export function googleRedirectUri(base: string) {
  const path = process.env.GOOGLE_REDIRECT_PATH ?? "/api/integrations/google/callback";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
