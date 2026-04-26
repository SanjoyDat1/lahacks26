import type { GoogleTokenPayload } from "./crypto";
import { loadGoogleWorkspaceEnvFromDisk } from "./config";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ].join(" "),
  );
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", opts.state);
  return u.toString();
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResponse> {
  loadGoogleWorkspaceEnvFromDisk();
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${t.slice(0, 400)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshGoogleAccess(refreshToken: string): Promise<TokenResponse> {
  loadGoogleWorkspaceEnvFromDisk();
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Refresh failed (${res.status}): ${t.slice(0, 400)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { email?: string };
    return j.email;
  } catch {
    return undefined;
  }
}

export async function ensureFreshAccessToken(payload: GoogleTokenPayload): Promise<GoogleTokenPayload> {
  const skew = 60_000;
  if (payload.expires_at > Date.now() + skew) return payload;
  if (!payload.refresh_token) {
    throw new Error("Google session expired; connect again.");
  }
  const next = await refreshGoogleAccess(payload.refresh_token);
  return {
    access_token: next.access_token,
    refresh_token: next.refresh_token ?? payload.refresh_token,
    expires_at: Date.now() + (next.expires_in ?? 3600) * 1000,
    email: payload.email,
  };
}
