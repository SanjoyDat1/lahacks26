import { NextRequest, NextResponse } from "next/server";

import { googleIntegrationConfigured } from "@/lib/integrations/google/config";
import { loadGoogleSessionForApi } from "@/lib/integrations/google/session-cookie";
import { listRecentDriveFiles } from "@/lib/integrations/google/workspace";

export async function GET(request: NextRequest) {
  if (!googleIntegrationConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  let session;
  try {
    session = await loadGoogleSessionForApi();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "session_refresh_failed";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
  if (!session) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  try {
    const files = await listRecentDriveFiles(session, { query: q, pageSize: 40 });
    return NextResponse.json({ files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
