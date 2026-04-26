import { cookies } from "next/headers";

import { decryptGooglePayload, encryptGooglePayload, type GoogleTokenPayload } from "./crypto";
import { getGoogleCookieSecret, GOOGLE_COOKIE_NAME, loadGoogleWorkspaceEnvFromDisk } from "./config";
import { ensureFreshAccessToken } from "./oauth";

const COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 45,
};

export async function readGoogleSessionCookie(): Promise<GoogleTokenPayload | null> {
  try {
    loadGoogleWorkspaceEnvFromDisk();
    const secret = process.env.GOOGLE_COOKIE_SECRET?.trim() ?? "";
    if (secret.length < 16) return null;
    const jar = await cookies();
    const raw = jar.get(GOOGLE_COOKIE_NAME)?.value;
    if (!raw) return null;
    return decryptGooglePayload(raw, getGoogleCookieSecret());
  } catch {
    return null;
  }
}

export async function writeGoogleSessionCookie(payload: GoogleTokenPayload) {
  const jar = await cookies();
  jar.set(GOOGLE_COOKIE_NAME, encryptGooglePayload(payload, getGoogleCookieSecret()), COOKIE_OPTS);
}

export async function clearGoogleSessionCookie() {
  const jar = await cookies();
  jar.set(GOOGLE_COOKIE_NAME, "", { ...COOKIE_OPTS, maxAge: 0 });
}

/**
 * Decrypt the session cookie, refresh the access token if near expiry, and
 * persist the new access token + expiry back to the cookie so later requests
 * do not hammer Google's token endpoint.
 */
export async function loadGoogleSessionForApi(): Promise<GoogleTokenPayload | null> {
  const raw = await readGoogleSessionCookie();
  if (!raw) return null;
  const fresh = await ensureFreshAccessToken(raw);
  const accessChanged = fresh.access_token !== raw.access_token;
  const expiryChanged = fresh.expires_at !== raw.expires_at;
  const refreshRotated =
    Boolean(fresh.refresh_token) && fresh.refresh_token !== raw.refresh_token;
  if (accessChanged || expiryChanged || refreshRotated) {
    await writeGoogleSessionCookie({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token ?? raw.refresh_token,
      expires_at: fresh.expires_at,
      email: fresh.email ?? raw.email,
    });
  }
  return fresh;
}
