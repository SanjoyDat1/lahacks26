import { NextResponse } from "next/server";

import { googleIntegrationConfigured } from "@/lib/integrations/google/config";
import { readGoogleSessionCookie } from "@/lib/integrations/google/session-cookie";

export async function GET() {
  if (!googleIntegrationConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
    });
  }

  const session = await readGoogleSessionCookie();
  if (!session) {
    return NextResponse.json({
      configured: true,
      connected: false,
    });
  }

  return NextResponse.json({
    configured: true,
    connected: true,
    email: session.email ?? null,
    expiresAt: session.expires_at,
  });
}
