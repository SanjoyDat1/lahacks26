import { NextRequest, NextResponse } from "next/server";

import { googleIntegrationConfigured } from "@/lib/integrations/google/config";
import { readGoogleSessionCookie } from "@/lib/integrations/google/session-cookie";
import {
  buildCalendarSnapshot,
  buildGmailSnapshot,
  extractSpreadsheetIdFromUrl,
  importDriveFiles,
  importSpreadsheetById,
} from "@/lib/integrations/google/workspace";

type Body = {
  fileIds?: string[];
  spreadsheetUrl?: string;
  includeCalendar?: boolean;
  includeGmail?: boolean;
};

export async function POST(request: NextRequest) {
  if (!googleIntegrationConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const session = await readGoogleSessionCookie();
  if (!session) {
    return NextResponse.json({ error: "not_connected" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const documents: Awaited<ReturnType<typeof importDriveFiles>> = [];

  try {
    const ids = Array.isArray(body.fileIds) ? body.fileIds.filter((x) => typeof x === "string" && x.length > 0) : [];
    if (ids.length) {
      documents.push(...(await importDriveFiles(session, ids)));
    }

    const sheetRaw = typeof body.spreadsheetUrl === "string" ? body.spreadsheetUrl.trim() : "";
    if (sheetRaw) {
      const sid = extractSpreadsheetIdFromUrl(sheetRaw);
      if (sid) {
        documents.push(await importSpreadsheetById(session, sid));
      }
    }

    if (body.includeCalendar) {
      documents.push(await buildCalendarSnapshot(session, { maxResults: 100 }));
    }

    if (body.includeGmail) {
      documents.push(await buildGmailSnapshot(session));
    }

    return NextResponse.json({ documents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "import_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
