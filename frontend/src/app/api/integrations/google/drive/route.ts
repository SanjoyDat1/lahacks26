import { NextRequest, NextResponse } from "next/server";

import { googleIntegrationConfigured } from "@/lib/integrations/google/config";
import { readGoogleSessionCookie } from "@/lib/integrations/google/session-cookie";
import { listRecentDriveFiles } from "@/lib/integrations/google/workspace";

export async function GET(request: NextRequest) {
  if (!googleIntegrationConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const session = await readGoogleSessionCookie();
  if (!session) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  try {
    const files = await listRecentDriveFiles(session, { query: q, pageSize: 30 });
    return NextResponse.json({ files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
