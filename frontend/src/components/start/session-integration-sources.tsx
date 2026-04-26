"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Calendar,
  Check,
  ChevronDown,
  File,
  FileSpreadsheet,
  Folder,
  Loader2,
  Mail,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type IntegrationDocBatch = {
  name: string;
  text?: string;
  content_base64?: string;
  mime_type?: string;
  size: number;
  chars: number;
};

export type ContextPillKind = "drive_folder" | "calendar" | "drive_extra" | "sheet" | "gmail";

export type ContextImportBatch = {
  documents: IntegrationDocBatch[];
  kind: ContextPillKind;
  label: string;
};

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email?: string | null;
};

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };

const FOLDER_MIME = "application/vnd.google-apps.folder";

function BrandImg({ src, className }: { src: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn("select-none", className)} draggable={false} />
  );
}

async function postImport(body: Record<string, unknown>): Promise<IntegrationDocBatch[]> {
  const res = await fetch("/api/integrations/google/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  let data: { documents?: IntegrationDocBatch[]; error?: string };
  try {
    data = JSON.parse(rawText) as { documents?: IntegrationDocBatch[]; error?: string };
  } catch {
    throw new Error(`Google import: bad response (${res.status}).`);
  }
  if (!res.ok) throw new Error(data.error ?? "Import failed");
  return data.documents ?? [];
}

/**
 * Google Workspace picker for session context. Designed for a modal/sheet opened from the attach menu.
 * Imports are split into logical batches (folder vs calendar vs extra files) so the parent can show one pill each.
 */
export function SessionIntegrationSources({
  disabled,
  onImportBatches,
  /** Only for real failures (network, API errors). Hints stay inside this panel — not the red “Session failed” banner. */
  onError,
  onClose,
  embeddedHeader,
  /** When true, fetch recent Drive once this panel is shown and the account is connected (e.g. modal open). */
  fetchDriveOnOpen = false,
}: {
  disabled: boolean;
  onImportBatches: (batches: ContextImportBatch[]) => void;
  onError: (msg: string) => void;
  /** Optional close control (e.g. modal X). */
  onClose?: () => void;
  /** When true, omit top “sheet” chrome so a parent modal supplies the title row. */
  embeddedHeader?: boolean;
  fetchDriveOnOpen?: boolean;
}) {
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  /** Exactly one company / project folder from the list (radio). */
  const [primaryFolderId, setPrimaryFolderId] = useState<string | null>(null);
  /** Individual Drive files to add beside the folder. */
  const [extraFileIds, setExtraFileIds] = useState<Set<string>>(() => new Set());
  const [importBusy, setImportBusy] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [includeCal, setIncludeCal] = useState(false);
  const [includeGmail, setIncludeGmail] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** Validation / empty-result hints shown in the modal only (never as global Session failed). */
  const [formHint, setFormHint] = useState<string | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    setFormHint(null);
  }, [primaryFolderId, folderUrl, extraFileIds, includeCal, sheetUrl, includeGmail]);

  const refreshGoogle = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google/status");
      const data = (await res.json()) as GoogleStatus;
      setGoogle(data);
    } catch {
      setGoogle({ configured: false, connected: false });
    }
  }, []);

  useEffect(() => {
    void refreshGoogle();
  }, [refreshGoogle]);

  const loadDrive = useCallback(async () => {
    if (!google?.connected) return;
    setDriveLoading(true);
    try {
      const res = await fetch("/api/integrations/google/drive");
      if (!res.ok) throw new Error("Could not list Drive files");
      const data = (await res.json()) as { files?: DriveFile[] };
      setDriveFiles(data.files ?? []);
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : "Drive list failed");
    } finally {
      setDriveLoading(false);
    }
  }, [google?.connected]);

  useEffect(() => {
    if (!fetchDriveOnOpen || !google?.connected) return;
    void loadDrive();
  }, [fetchDriveOnOpen, google?.connected, loadDrive]);

  const primaryFolderName =
    (primaryFolderId && driveFiles.find((f) => f.id === primaryFolderId)?.name) || "Company folder";

  const toggleExtraFile = (id: string) => {
    setExtraFileIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const setPrimaryFolder = (id: string | null) => {
    setPrimaryFolderId(id);
    if (id) setFolderUrl("");
  };

  const runAddToContext = async () => {
    if (importBusy || disabled) return;
    setImportBusy(true);
    setFormHint(null);
    const batches: ContextImportBatch[] = [];
    try {
      const hasPrimaryPath = Boolean(primaryFolderId) || folderUrl.trim().length > 0;
      const extraIds = [...extraFileIds];

      if (hasPrimaryPath) {
        const docs = await postImport({
          folderIds: primaryFolderId ? [primaryFolderId] : [],
          folderUrl: folderUrl.trim() || undefined,
        });
        if (docs.length) {
          batches.push({
            documents: docs,
            kind: "drive_folder",
            label: primaryFolderId ? `Folder · ${primaryFolderName}` : "Folder · link",
          });
        }
      }

      if (extraIds.length > 0) {
        const docs = await postImport({ fileIds: extraIds });
        for (const d of docs) {
          batches.push({
            documents: [d],
            kind: "drive_extra",
            label: d.name,
          });
        }
      }

      const sheetRaw = sheetUrl.trim();
      if (sheetRaw) {
        const docs = await postImport({ spreadsheetUrl: sheetRaw });
        if (docs.length) {
          const label = docs[0]?.name ? `Sheet · ${docs[0].name}` : "Google Sheet";
          batches.push({ documents: docs, kind: "sheet", label });
        }
      }

      if (includeCal) {
        const docs = await postImport({ includeCalendar: true });
        if (docs.length) {
          batches.push({
            documents: docs,
            kind: "calendar",
            label: "Calendar · next 14 days",
          });
        }
      }

      if (includeGmail) {
        const docs = await postImport({ includeGmail: true });
        if (docs.length) {
          batches.push({
            documents: docs,
            kind: "gmail",
            label: "Gmail recap",
          });
        }
      }

      if (!batches.length) {
        setFormHint(
          "Nothing was imported. Choose a company folder (or paste a link), pick extra files, add a sheet, and/or enable calendar, then try again.",
        );
        return;
      }

      onImportBatches(batches);

      setPrimaryFolderId(null);
      setExtraFileIds(new Set());
      setFolderUrl("");
      setSheetUrl("");
      setIncludeCal(false);
      setIncludeGmail(false);
      onClose?.();
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    await fetch("/api/integrations/google/disconnect", { method: "POST" });
    setGoogle((g) => (g ? { ...g, connected: false } : g));
    setDriveFiles([]);
    setPrimaryFolderId(null);
    setExtraFileIds(new Set());
  };

  const canSubmit =
    Boolean(primaryFolderId) ||
    folderUrl.trim().length > 0 ||
    extraFileIds.size > 0 ||
    sheetUrl.trim().length > 0 ||
    includeCal ||
    includeGmail;

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        embeddedHeader ? "" : "rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-lg ring-1 ring-slate-100/80",
      )}
    >
      {embeddedHeader ? (
        <p className="text-[15px] font-semibold tracking-tight text-slate-900">Add from Google</p>
      ) : null}
      {!embeddedHeader ? (
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Google Workspace</h2>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-2xl border px-3 py-3 transition",
          google?.connected
            ? "border-slate-200/90 bg-white ring-1 ring-slate-100/80"
            : "border-slate-200/80 bg-slate-50/80 ring-1 ring-slate-100/60",
        )}
      >
        {google === null ? (
          <p className="flex items-center gap-2 px-1 py-2 text-[13px] text-slate-500">
            <Loader2 size={14} className="animate-spin text-violet-500" />
            Checking Google…
          </p>
        ) : !google.configured ? (
          <p className="px-1 py-1 text-[12px] leading-snug text-amber-800">
            Set Google OAuth variables in <span className="font-mono text-[11px]">.env</span>, then restart the dev server.
          </p>
        ) : !google.connected ? (
          <div className="flex flex-wrap items-center gap-3 px-1 py-1">
            <BrandImg src="/brand/google-workspace.svg" className="h-9 w-9" />
            <a
              href="/api/integrations/google/authorize?next=/start"
              className={cn(
                "inline-flex flex-1 items-center justify-center rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-sm transition sm:flex-none",
                disabled
                  ? "pointer-events-none bg-slate-100 text-slate-400"
                  : "bg-violet-600 text-white hover:bg-violet-700",
              )}
            >
              Connect Google account
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Compact account row */}
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                <BrandImg src="/brand/google-workspace.svg" className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  {google.email ?? "Connected"}
                </p>
                <p className="text-[11px] text-emerald-600">Active</p>
              </div>
              <button
                type="button"
                disabled={disabled || driveLoading}
                onClick={() => void loadDrive()}
                title="Refresh Drive list"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200/90 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={15} className={driveLoading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void disconnectGoogle()}
                title="Disconnect"
                className="flex h-9 flex-shrink-0 items-center gap-1 rounded-xl px-2.5 text-[12px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <Unplug size={14} />
                <span className="hidden sm:inline">Out</span>
              </button>
            </div>

            {/* Folder link — one field, no duplicate headings */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-600">Company folder</label>
              <input
                value={folderUrl}
                disabled={disabled}
                onChange={(e) => {
                  setFolderUrl(e.target.value);
                  if (e.target.value.trim()) setPrimaryFolderId(null);
                }}
                placeholder="Paste Drive folder URL, or pick a folder below"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            {/* Drive list — icon = type, no “EXTRA” column */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-600">Recent in Drive</span>
                <span className="text-[10px] text-slate-400">
                  <span className="text-amber-700/90">●</span> main · <span className="text-violet-600">■</span> also
                </span>
              </div>
              <div className="max-h-[200px] space-y-0.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/40 p-1">
                {driveLoading && driveFiles.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 px-3 py-8 text-center text-[12px] text-slate-500">
                    <Loader2 size={16} className="animate-spin text-violet-500" />
                    Loading Drive…
                  </p>
                ) : driveFiles.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[12px] text-slate-400">
                    No recent items. Use the refresh button or paste a folder link above.
                  </p>
                ) : (
                  driveFiles.map((f) => {
                    const isFolder = f.mimeType === FOLDER_MIME;
                    const isPrimary = primaryFolderId === f.id;
                    const isExtra = extraFileIds.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (isFolder) {
                            setPrimaryFolder(isPrimary ? null : f.id);
                          } else {
                            toggleExtraFile(f.id);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                          isFolder && isPrimary
                            ? "bg-amber-50 ring-1 ring-amber-200/90"
                            : !isFolder && isExtra
                              ? "bg-violet-50 ring-1 ring-violet-200/80"
                              : "hover:bg-white",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center border-2",
                            isFolder ? "rounded-full" : "rounded-[4px]",
                            isFolder
                              ? isPrimary
                                ? "border-amber-500 bg-amber-500 text-white"
                                : "border-slate-300 bg-white"
                              : isExtra
                                ? "border-violet-500 bg-violet-500 text-white"
                                : "border-slate-300 bg-white",
                          )}
                          aria-hidden
                        >
                          {(isFolder && isPrimary) || (!isFolder && isExtra) ? (
                            <Check size={11} strokeWidth={3} className="text-white" />
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                            isFolder ? "bg-amber-100 text-amber-800" : "bg-slate-200/80 text-slate-600",
                          )}
                        >
                          {isFolder ? <Folder size={16} strokeWidth={2} /> : <File size={16} strokeWidth={2} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{f.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Calendar — always visible, compact */}
            <button
              type="button"
              disabled={disabled}
              role="switch"
              aria-checked={includeCal}
              onClick={() => setIncludeCal((v) => !v)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                includeCal
                  ? "border-violet-200 bg-violet-50/80 ring-1 ring-violet-200/60"
                  : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              <span
                className={cn(
                  "relative h-[22px] w-10 flex-shrink-0 rounded-full transition-colors",
                  includeCal ? "bg-violet-600" : "bg-slate-300",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-[left]",
                    includeCal ? "left-5" : "left-0.5",
                  )}
                />
              </span>
              <Calendar size={16} className="flex-shrink-0 text-slate-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-slate-900">Calendar</span>
                <span className="block text-[11px] text-slate-500">Next ~14 days of events</span>
              </span>
            </button>

            {formHint ? (
              <p className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[12px] leading-snug text-amber-950">
                {formHint}
              </p>
            ) : null}

            <button
              type="button"
              disabled={disabled || importBusy || !canSubmit}
              onClick={() => void runAddToContext()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-semibold transition",
                disabled || importBusy || !canSubmit
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-violet-600 text-white shadow-md shadow-violet-200/50 hover:bg-violet-700",
              )}
            >
              {importBusy ? <Loader2 size={16} className="animate-spin" /> : null}
              Add to context
            </button>

            <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[12px] font-medium text-slate-600"
              >
                Sheet & Gmail
                <ChevronDown size={14} className={cn("text-slate-400 transition", advancedOpen && "rotate-180")} />
              </button>
              {advancedOpen ? (
                <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-2">
                  <label className="block">
                    <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-600">
                      <FileSpreadsheet size={12} />
                      Spreadsheet URL
                    </span>
                    <input
                      value={sheetUrl}
                      disabled={disabled}
                      onChange={(e) => setSheetUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/…"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-500/20"
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 py-1 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      checked={includeGmail}
                      disabled={disabled}
                      onChange={(e) => setIncludeGmail(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-violet-600"
                    />
                    <Mail size={15} className="text-slate-500" />
                    Gmail recap
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
