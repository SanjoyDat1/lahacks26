import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  appBaseUrl,
  GOOGLE_NEXT_COOKIE,
  GOOGLE_STATE_COOKIE,
  googleIntegrationConfigured,
  googleRedirectUri,
} from "@/lib/integrations/google/config";
import { exchangeGoogleCode, fetchGoogleUserEmail } from "@/lib/integrations/google/oauth";
import { readGoogleSessionCookie, writeGoogleSessionCookie } from "@/lib/integrations/google/session-cookie";

export async function GET(request: NextRequest) {
  if (!googleIntegrationConfigured()) {
    return NextResponse.redirect(new URL("/start?google=unconfigured", request.url));
  }

  const err = request.nextUrl.searchParams.get("error");
  if (err) {
    return NextResponse.redirect(new URL(`/start?google=error&message=${encodeURIComponent(err)}`, request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get(GOOGLE_STATE_COOKIE)?.value;

  jar.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  const nextRaw = jar.get(GOOGLE_NEXT_COOKIE)?.value ?? "/start";
  jar.set(GOOGLE_NEXT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

  const nextPath = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/start";

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/start?google=error&message=invalid_state", request.url));
  }

  const base = appBaseUrl(request.url);
  const redirectUri = googleRedirectUri(base);

  try {
    const tokens = await exchangeGoogleCode(code, redirectUri);
    const email = await fetchGoogleUserEmail(tokens.access_token);
    const previous = await readGoogleSessionCookie();
    await writeGoogleSessionCookie({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? previous?.refresh_token,
      expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      email: email ?? previous?.email,
    });
    return NextResponse.redirect(new URL(`${nextPath}?google=connected`, request.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "oauth_failed";
    return NextResponse.redirect(new URL(`/start?google=error&message=${encodeURIComponent(msg)}`, request.url));
  }
}
