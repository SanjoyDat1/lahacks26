import { NextRequest, NextResponse } from "next/server";

import { googleIntegrationConfigured } from "@/lib/integrations/google/config";
import { loadGoogleSessionForApi } from "@/lib/integrations/google/session-cookie";
import {
  buildCalendarSnapshot,
  buildGmailSnapshot,
  expandDriveFoldersToFileIds,
  extractDriveFolderIdFromUrl,
  extractSpreadsheetIdFromUrl,
  importDriveFiles,
  importSpreadsheetById,
} from "@/lib/integrations/google/workspace";

type Body = {
  fileIds?: string[];
  /** Drive folder ids — expanded recursively (capped) into file ids before import. */
  folderIds?: string[];
  /** Paste a drive.google.com/.../folders/... link (optional). */
  folderUrl?: string;
  spreadsheetUrl?: string;
  includeCalendar?: boolean;
  includeGmail?: boolean;
};

export async function POST(request: NextRequest) {
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const documents: Awaited<ReturnType<typeof importDriveFiles>> = [];

  try {
    const rawFileIds = Array.isArray(body.fileIds)
      ? body.fileIds.filter((x) => typeof x === "string" && x.length > 0)
      : [];
    const rawFolderIds = Array.isArray(body.folderIds)
      ? body.folderIds.filter((x) => typeof x === "string" && x.length > 0)
      : [];
    const fromUrl =
      typeof body.folderUrl === "string" ? extractDriveFolderIdFromUrl(body.folderUrl.trim()) : null;
    const folderDedup = new Set<string>(rawFolderIds);
    if (fromUrl) folderDedup.add(fromUrl);
    const allFolderIds = [...folderDedup];

    const fromFolders =
      allFolderIds.length > 0 ? await expandDriveFoldersToFileIds(session, allFolderIds) : [];

    const mergedDriveIds = [...rawFileIds, ...fromFolders];
    const seen = new Set<string>();
    const driveIds: string[] = [];
    for (const id of mergedDriveIds) {
      if (!seen.has(id)) {
        seen.add(id);
        driveIds.push(id);
      }
    }

    if (driveIds.length) {
      documents.push(...(await importDriveFiles(session, driveIds)));
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
