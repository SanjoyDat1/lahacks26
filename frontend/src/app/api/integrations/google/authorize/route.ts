import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  appBaseUrl,
  GOOGLE_NEXT_COOKIE,
  GOOGLE_STATE_COOKIE,
  googleIntegrationConfigured,
  googleRedirectUri,
} from "@/lib/integrations/google/config";
import { buildGoogleAuthUrl } from "@/lib/integrations/google/oauth";

const SHORT = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600,
};

export async function GET(request: NextRequest) {
  if (!googleIntegrationConfigured()) {
    return NextResponse.json(
      {
        error: "Google Workspace is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_COOKIE_SECRET (16+ chars).",
      },
      { status: 501 },
    );
  }

  const state = randomBytes(24).toString("hex");
  const nextPath = request.nextUrl.searchParams.get("next") ?? "/start";
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/start";

  const jar = await cookies();
  jar.set(GOOGLE_STATE_COOKIE, state, SHORT);
  jar.set(GOOGLE_NEXT_COOKIE, safeNext, SHORT);

  const base = appBaseUrl(request.url);
  const url = buildGoogleAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri: googleRedirectUri(base),
    state,
  });

  return NextResponse.redirect(url);
}
