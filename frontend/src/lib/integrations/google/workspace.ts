import mammoth from "mammoth";
import * as XLSX from "xlsx";

import type { GoogleTokenPayload } from "./crypto";
import { ensureFreshAccessToken } from "./oauth";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export type DriveListItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

export type ImportedDoc = {
  name: string;
  text?: string;
  content_base64?: string;
  mime_type?: string;
  size: number;
  chars: number;
  source: "google_drive";
};

const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const SLIDE_MIME = "application/vnd.google-apps.presentation";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Uploaded Microsoft Office files in Drive (not native Google Docs/Sheets). */
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fileNameEndsWith(name: string, ext: string) {
  return name.toLowerCase().endsWith(ext);
}

async function gfetch(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google API ${res.status}: ${t.slice(0, 500)}`);
  }
  return res;
}

/** Recent files and folders (folders can be selected to import entire trees — see `expandDriveFoldersToFileIds`). */
export async function listRecentDriveFiles(
  payload: GoogleTokenPayload,
  opts?: { query?: string; pageSize?: number },
): Promise<DriveListItem[]> {
  const p = await ensureFreshAccessToken(payload);
  const qParts = ["trashed = false"];
  const rawQ = opts?.query?.trim();
  if (rawQ) {
    const safe = rawQ.replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 80);
    if (safe.length > 0) qParts.push(`name contains '${safe.replace(/'/g, "\\'")}'`);
  }
  const q = qParts.join(" and ");
  const u = new URL(`${DRIVE_BASE}/files`);
  u.searchParams.set("pageSize", String(opts?.pageSize ?? 25));
  u.searchParams.set("q", q);
  u.searchParams.set("orderBy", "modifiedTime desc");
  u.searchParams.set("corpora", "allDrives");
  u.searchParams.set("includeItemsFromAllDrives", "true");
  u.searchParams.set("supportsAllDrives", "true");
  u.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime)",
  );
  const res = await gfetch(u.toString(), p.access_token);
  const data = (await res.json()) as { files?: DriveListItem[] };
  return data.files ?? [];
}

function driveIdInQuery(id: string): string {
  return id.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Cached result of `files.get` so we list children with the right corpus (per-folder). */
type FolderDriveContext = { sharedDriveId?: string };

async function resolveFolderDriveContext(
  accessToken: string,
  folderId: string,
  cache: Map<string, FolderDriveContext>,
): Promise<FolderDriveContext> {
  const hit = cache.get(folderId);
  if (hit) return hit;
  const u = new URL(`${DRIVE_BASE}/files/${encodeURIComponent(folderId)}`);
  u.searchParams.set("fields", "id,driveId");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await gfetch(u.toString(), accessToken);
  const data = (await res.json()) as { driveId?: string };
  const ctx: FolderDriveContext = data.driveId ? { sharedDriveId: data.driveId } : {};
  cache.set(folderId, ctx);
  return ctx;
}

/**
 * List immediate children of a folder. Must not blindly set `corpora=allDrives` with
 * `'folderId' in parents` — that combination often returns **no files** for folders in
 * My Drive. Use `corpora=drive` + `driveId` only when `files.get` says the folder
 * lives on a shared drive; otherwise omit `corpora` (default user corpus).
 */
async function listFolderChildrenPage(
  accessToken: string,
  folderId: string,
  corpusCache: Map<string, FolderDriveContext>,
  pageToken?: string,
): Promise<{ files: DriveListItem[]; nextPageToken?: string }> {
  const { sharedDriveId } = await resolveFolderDriveContext(accessToken, folderId, corpusCache);
  const q = `'${driveIdInQuery(folderId)}' in parents and trashed = false`;

  const fetchPage = async (mode: "default" | "allDrives") => {
    const u = new URL(`${DRIVE_BASE}/files`);
    u.searchParams.set("q", q);
    u.searchParams.set("pageSize", "100");
    u.searchParams.set("supportsAllDrives", "true");
    u.searchParams.set("includeItemsFromAllDrives", "true");
    if (mode === "allDrives") {
      u.searchParams.set("corpora", "allDrives");
    } else if (sharedDriveId) {
      u.searchParams.set("corpora", "drive");
      u.searchParams.set("driveId", sharedDriveId);
    }
    u.searchParams.set("fields", "nextPageToken, files(id,name,mimeType)");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await gfetch(u.toString(), accessToken);
    return (await res.json()) as {
      files?: DriveListItem[];
      nextPageToken?: string;
    };
  };

  let data = await fetchPage("default");
  if (
    !pageToken &&
    !(data.files?.length) &&
    !data.nextPageToken &&
    !sharedDriveId
  ) {
    data = await fetchPage("allDrives");
  }

  return { files: data.files ?? [], nextPageToken: data.nextPageToken };
}

/**
 * Breadth-first walk of selected folders; collects non-folder file ids only.
 * Capped to protect session size and API quotas.
 */
export async function expandDriveFoldersToFileIds(
  payload: GoogleTokenPayload,
  folderIds: string[],
  opts?: { maxFiles?: number; maxDepth?: number },
): Promise<string[]> {
  const maxFiles = Math.min(Math.max(1, opts?.maxFiles ?? 80), 200);
  const maxDepth = Math.min(Math.max(1, opts?.maxDepth ?? 12), 24);
  const p = await ensureFreshAccessToken(payload);
  const fileIds: string[] = [];
  const seenFiles = new Set<string>();
  const enqueuedFolders = new Set<string>();
  const corpusCache = new Map<string, FolderDriveContext>();
  const queue: { id: string; depth: number }[] = [];

  for (const id of folderIds) {
    if (id && !enqueuedFolders.has(id)) {
      enqueuedFolders.add(id);
      queue.push({ id, depth: 0 });
    }
  }

  while (queue.length > 0 && fileIds.length < maxFiles) {
    const { id: folderId, depth } = queue.shift()!;
    if (depth > maxDepth) continue;

    let pageToken: string | undefined;
    do {
      const { files, nextPageToken } = await listFolderChildrenPage(
        p.access_token,
        folderId,
        corpusCache,
        pageToken,
      );
      for (const f of files) {
        if (fileIds.length >= maxFiles) break;
        if (f.mimeType === FOLDER_MIME) {
          if (depth + 1 <= maxDepth && !enqueuedFolders.has(f.id)) {
            enqueuedFolders.add(f.id);
            queue.push({ id: f.id, depth: depth + 1 });
          }
        } else if (!seenFiles.has(f.id)) {
          seenFiles.add(f.id);
          fileIds.push(f.id);
        }
      }
      pageToken = nextPageToken;
    } while (pageToken && fileIds.length < maxFiles);
  }

  return fileIds;
}

async function getFileMeta(accessToken: string, fileId: string) {
  const u = new URL(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`);
  u.searchParams.set("fields", "id,name,mimeType,size");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await gfetch(u.toString(), accessToken);
  return (await res.json()) as { id: string; name: string; mimeType: string; size?: string };
}

async function exportFile(accessToken: string, fileId: string, mime: string) {
  const u = new URL(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/export`);
  u.searchParams.set("mimeType", mime);
  u.searchParams.set("supportsAllDrives", "true");
  const res = await gfetch(u.toString(), accessToken);
  return res.text();
}

async function downloadMedia(accessToken: string, fileId: string) {
  const u = new URL(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`);
  u.searchParams.set("alt", "media");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await gfetch(u.toString(), accessToken);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function sheetAsTsv(accessToken: string, spreadsheetId: string) {
  const metaUrl = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title))`;
  const metaRes = await gfetch(metaUrl, accessToken);
  const meta = (await metaRes.json()) as { sheets?: { properties?: { title?: string } }[] };
  const title = meta.sheets?.[0]?.properties?.title ?? "Sheet1";
  const range = encodeURIComponent(`${title}!A1:Z5000`);
  const valUrl = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${range}`;
  const valRes = await gfetch(valUrl, accessToken);
  const vals = (await valRes.json()) as { values?: string[][] };
  const rows = vals.values ?? [];
  return rows.map((r) => r.join("\t")).join("\n");
}

export async function importDriveFiles(
  payload: GoogleTokenPayload,
  fileIds: string[],
): Promise<ImportedDoc[]> {
  const p = await ensureFreshAccessToken(payload);
  const out: ImportedDoc[] = [];
  const maxCharsPerFile = 150_000;
  const maxTotal = 400_000;
  let total = 0;

  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const id of fileIds) {
    if (id && !seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  for (const fileId of uniqueIds) {
    if (total >= maxTotal) break;
    const meta = await getFileMeta(p.access_token, fileId);
    let text: string | undefined;
    let content_base64: string | undefined;
    let mimeOut = meta.mimeType;

    if (meta.mimeType === DOC_MIME || meta.mimeType === SLIDE_MIME) {
      text = await exportFile(p.access_token, fileId, "text/plain");
    } else if (meta.mimeType === SHEET_MIME) {
      text = await sheetAsTsv(p.access_token, fileId);
      mimeOut = "text/tab-separated-values";
    } else if (meta.mimeType === DOCX_MIME || fileNameEndsWith(meta.name, ".docx")) {
      try {
        const buf = await downloadMedia(p.access_token, fileId);
        const { value } = await mammoth.extractRawText({ buffer: buf });
        text = value?.trim() ? value : undefined;
        mimeOut = "text/plain";
      } catch {
        continue;
      }
    } else if (meta.mimeType === XLSX_MIME || fileNameEndsWith(meta.name, ".xlsx")) {
      try {
        const buf = await downloadMedia(p.access_token, fileId);
        const wb = XLSX.read(buf, { type: "buffer" });
        const parts: string[] = [];
        const maxSheets = 12;
        for (const sheetName of wb.SheetNames.slice(0, maxSheets)) {
          const sheet = wb.Sheets[sheetName];
          if (!sheet) continue;
          const csv = XLSX.utils.sheet_to_csv(sheet);
          parts.push(`## ${sheetName}\n${csv}`);
        }
        const joined = parts.join("\n\n");
        text = joined.trim() ? joined : undefined;
        mimeOut = "text/plain";
      } catch {
        continue;
      }
    } else if (meta.mimeType.startsWith("text/") || meta.mimeType === "application/json") {
      const buf = await downloadMedia(p.access_token, fileId);
      text = buf.toString("utf8");
    } else if (meta.mimeType === "application/pdf") {
      const buf = await downloadMedia(p.access_token, fileId);
      content_base64 = buf.toString("base64");
      mimeOut = "application/pdf";
    } else {
      try {
        text = await exportFile(p.access_token, fileId, "text/plain");
      } catch {
        continue;
      }
    }

    if (text) {
      const slice = text.length > maxCharsPerFile ? text.slice(0, maxCharsPerFile) + "\n…[truncated]" : text;
      const chars = slice.length;
      if (total + chars > maxTotal) {
        const room = maxTotal - total;
        if (room < 500) break;
        out.push({
          name: `[Drive] ${meta.name}`,
          text: slice.slice(0, room) + "\n…[truncated for session budget]",
          mime_type: mimeOut,
          size: chars,
          chars: room,
          source: "google_drive",
        });
        break;
      }
      total += chars;
      out.push({
        name: `[Drive] ${meta.name}`,
        text: slice,
        mime_type: mimeOut,
        size: chars,
        chars,
        source: "google_drive",
      });
    } else if (content_base64) {
      const approx = Math.floor(content_base64.length * 0.75);
      if (total + approx > maxTotal) continue;
      total += approx;
      out.push({
        name: `[Drive] ${meta.name}`,
        content_base64,
        mime_type: mimeOut,
        size: approx,
        chars: approx,
        source: "google_drive",
      });
    }
  }

  return out;
}

export async function buildCalendarSnapshot(
  payload: GoogleTokenPayload,
  opts?: { maxResults?: number },
): Promise<ImportedDoc> {
  const p = await ensureFreshAccessToken(payload);
  const max = Math.min(opts?.maxResults ?? 80, 250);
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const u = new URL(`${CAL_BASE}/calendars/primary/events`);
  u.searchParams.set("timeMin", timeMin);
  u.searchParams.set("timeMax", timeMax);
  u.searchParams.set("singleEvents", "true");
  u.searchParams.set("orderBy", "startTime");
  u.searchParams.set("maxResults", String(max));
  const res = await gfetch(u.toString(), p.access_token);
  const data = (await res.json()) as {
    items?: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; description?: string }[];
  };
  const lines: string[] = ["Google Calendar snapshot (next 14 days, primary calendar)", ""];
  for (const ev of data.items ?? []) {
    const start = ev.start?.dateTime ?? ev.start?.date ?? "";
    const end = ev.end?.dateTime ?? ev.end?.date ?? "";
    lines.push(`• ${ev.summary ?? "(no title)"} — ${start}${end && end !== start ? ` → ${end}` : ""}`);
    if (ev.description?.trim()) lines.push(`  ${ev.description.trim().split("\n").join(" ").slice(0, 400)}`);
  }
  const text = lines.join("\n");
  return {
    name: "[Google Calendar] Upcoming events",
    text,
    mime_type: "text/plain",
    size: text.length,
    chars: text.length,
    source: "google_drive",
  };
}

/** Import a Sheet by ID from a share URL (no separate Drive file id). */
export async function importSpreadsheetById(
  payload: GoogleTokenPayload,
  spreadsheetId: string,
): Promise<ImportedDoc> {
  const p = await ensureFreshAccessToken(payload);
  const text = await sheetAsTsv(p.access_token, spreadsheetId);
  const slice = text.length > 200_000 ? text.slice(0, 200_000) + "\n…[truncated]" : text;
  return {
    name: `[Google Sheet] ${spreadsheetId}`,
    text: slice,
    mime_type: "text/tab-separated-values",
    size: slice.length,
    chars: slice.length,
    source: "google_drive",
  };
}

export async function buildGmailSnapshot(payload: GoogleTokenPayload): Promise<ImportedDoc> {
  const p = await ensureFreshAccessToken(payload);
  const listUrl =
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:7d&maxResults=15";
  const res = await gfetch(listUrl, p.access_token);
  const data = (await res.json()) as { messages?: { id: string }[] };
  const ids = (data.messages ?? []).map((m) => m.id).filter(Boolean);
  const lines: string[] = ["Gmail snapshot (recent messages, last 7 days)", ""];
  for (const id of ids) {
    const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`;
    try {
      const r = await gfetch(u, p.access_token);
      const msg = (await r.json()) as {
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const headers = msg.payload?.headers ?? [];
      const sub = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      lines.push(`• ${sub}${from ? ` — ${from}` : ""}`);
      if (msg.snippet?.trim()) lines.push(`  ${msg.snippet.trim().slice(0, 280)}`);
    } catch {
      /* skip individual message */
    }
  }
  const text = lines.join("\n");
  return {
    name: "[Gmail] Recent messages",
    text,
    mime_type: "text/plain",
    size: text.length,
    chars: text.length,
    source: "google_drive",
  };
}

/** Google Drive folder URL → folder id (for “import this folder”). */
export function extractDriveFolderIdFromUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const m = u.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (m?.[1]) return m[1];
  } catch {
    /* fall through */
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

export function extractSpreadsheetIdFromUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m?.[1]) return m[1];
    const openId = u.searchParams.get("id");
    if (
      (u.hostname === "docs.google.com" || u.hostname.endsWith(".docs.google.com")) &&
      openId &&
      /^[a-zA-Z0-9-_]{30,}$/.test(openId)
    ) {
      return openId;
    }
  } catch {
    /* fall through */
  }
  if (/^[a-zA-Z0-9-_]{30,}$/.test(s)) return s;
  return null;
}
