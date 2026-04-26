import { cookies } from "next/headers";

import { decryptGooglePayload, encryptGooglePayload, type GoogleTokenPayload } from "./crypto";
import { getGoogleCookieSecret, GOOGLE_COOKIE_NAME } from "./config";

const COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 45,
};

export async function readGoogleSessionCookie(): Promise<GoogleTokenPayload | null> {
  try {
    const secret = process.env.GOOGLE_COOKIE_SECRET;
    if (!secret || secret.length < 16) return null;
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
