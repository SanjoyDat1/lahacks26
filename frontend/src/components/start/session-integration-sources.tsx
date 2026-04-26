"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Check,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Unplug,
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

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email?: string | null;
};

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string };

function meetingsWebhookFromEnv(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/api/ingest/meetings` : "/api/ingest/meetings";
}

function BrandImg({ src, className }: { src: string; className?: string }) {
  return (
    // Local brand SVGs in /public — avoid next/image SVG optimizer quirks
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn("select-none", className)} draggable={false} />
  );
}

export function SessionIntegrationSources({
  disabled,
  onImported,
  onLog,
}: {
  disabled: boolean;
  onImported: (items: IntegrationDocBatch[]) => void;
  onLog: (msg: string) => void;
}) {
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [importBusy, setImportBusy] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [includeCal, setIncludeCal] = useState(false);
  const [includeGmail, setIncludeGmail] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** Same on server + first client paint; optionally upgraded after mount when env is unset. */
  const [meetingsWebhook, setMeetingsWebhook] = useState(() => meetingsWebhookFromEnv());

  useEffect(() => {
    if ((process.env.NEXT_PUBLIC_APP_URL ?? "").trim()) return;
    setMeetingsWebhook(`${window.location.origin}/api/ingest/meetings`);
  }, []);

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
      onLog(`Loaded ${(data.files ?? []).length} recent Drive files.`);
    } catch (e) {
      onLog(e instanceof Error ? e.message : "Drive list failed");
    } finally {
      setDriveLoading(false);
    }
  }, [google?.connected, onLog]);

  useEffect(() => {
    if (google?.connected) void loadDrive();
  }, [google?.connected, loadDrive]);

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const runImport = async () => {
    if (importBusy || disabled) return;
    setImportBusy(true);
    try {
      const res = await fetch("/api/integrations/google/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileIds: [...selected],
          spreadsheetUrl: sheetUrl.trim() || undefined,
          includeCalendar: includeCal,
          includeGmail: includeGmail,
        }),
      });
      const data = (await res.json()) as { documents?: IntegrationDocBatch[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const docs = data.documents ?? [];
      if (!docs.length) {
        onLog("Nothing imported—select Drive files, Sheet URL, calendar, and/or Gmail recap.");
        return;
      }
      onImported(docs);
      onLog(
        `Imported ${docs.length} Workspace source${docs.length === 1 ? "" : "s"} (${docs.reduce((s, d) => s + d.chars, 0).toLocaleString()} chars).`,
      );
      setSelected(new Set());
      setIncludeCal(false);
      setIncludeGmail(false);
    } catch (e) {
      onLog(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    await fetch("/api/integrations/google/disconnect", { method: "POST" });
    setGoogle((g) => (g ? { ...g, connected: false } : g));
    setDriveFiles([]);
    setSelected(new Set());
    onLog("Disconnected Google Workspace.");
  };

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onLog("Could not copy to clipboard.");
    }
  };

  return (
    <div className="grid gap-4">
      {/* Google Workspace */}
      <div
        className={cn(
          "rounded-[1.75rem] border p-5 shadow-sm ring-1 transition",
          google?.connected
            ? "border-violet-200/90 bg-gradient-to-br from-violet-50/90 via-white to-white ring-violet-100/80"
            : "border-slate-200/90 bg-white ring-slate-100/80",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl shadow-md",
              google?.connected ? "bg-white shadow-violet-200/50 ring-1 ring-violet-100" : "bg-white ring-1 ring-slate-100",
            )}
          >
            <BrandImg src="/brand/google-workspace.svg" className="h-8 w-8" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Google Workspace</h3>
              {google?.connected ? (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-800 ring-1 ring-violet-200/80">
                  Connected
                </span>
              ) : google && !google.configured ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200/70">
                  Setup required
                </span>
              ) : google ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-slate-200/80">
                  Sign in
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Drive, Docs, Sheets, Calendar, and Gmail metadata (read-only). Tokens live in an encrypted httpOnly cookie;
              imports become session documents for the brain agent.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {google === null ? (
                <p className="flex items-center gap-2 text-[11px] text-slate-500">
                  <Loader2 size={12} className="animate-spin text-violet-500" />
                  Checking Google Workspace status…
                </p>
              ) : !google.configured ? (
                <p className="text-[11px] leading-relaxed text-amber-800">
                  Add <span className="font-mono">GOOGLE_CLIENT_ID</span>,{" "}
                  <span className="font-mono">GOOGLE_CLIENT_SECRET</span>, and{" "}
                  <span className="font-mono">GOOGLE_COOKIE_SECRET</span> (16+ chars) to{" "}
                  <span className="font-mono">.env.local</span>. Redirect URI:{" "}
                  <span className="font-mono text-[10px]">/api/integrations/google/callback</span>
                </p>
              ) : !google.connected ? (
                <a
                  href="/api/integrations/google/authorize?next=/start"
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-sm transition",
                    disabled
                      ? "pointer-events-none bg-slate-100 text-slate-400"
                      : "bg-violet-600 text-white shadow-violet-300/40 hover:bg-violet-700",
                  )}
                >
                  Connect Google Workspace
                </a>
              ) : (
                <>
                  <p className="w-full text-[11px] text-violet-900/80">
                    Signed in{google.email ? ` as ${google.email}` : ""}.
                  </p>
                  <button
                    type="button"
                    disabled={disabled || driveLoading}
                    onClick={() => void loadDrive()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={driveLoading ? "animate-spin" : ""} />
                    Refresh Drive
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void disconnectGoogle()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Unplug size={12} />
                    Disconnect
                  </button>
                </>
              )}
            </div>

            {google?.connected ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-violet-100/90 bg-white/80 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recent Drive files</p>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {driveFiles.length === 0 && !driveLoading ? (
                    <p className="text-[11px] text-slate-400">No files listed yet.</p>
                  ) : (
                    driveFiles.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleSel(f.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[11px] transition",
                          selected.has(f.id) ? "bg-violet-100 text-violet-900" : "hover:bg-slate-50 text-slate-700",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                            selected.has(f.id) ? "border-violet-500 bg-violet-500 text-white" : "border-slate-300",
                          )}
                        >
                          {selected.has(f.id) ? <Check size={10} strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                      </button>
                    ))
                  )}
                </div>

                <label className="block">
                  <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <FileSpreadsheet size={11} />
                    Sheet URL (optional)
                  </span>
                  <input
                    value={sheetUrl}
                    disabled={disabled}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                </label>

                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeCal}
                    disabled={disabled}
                    onChange={(e) => setIncludeCal(e.target.checked)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500/30"
                  />
                  <Calendar size={14} className="text-slate-400" />
                  Include primary calendar snapshot (next 14 days)
                </label>

                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={includeGmail}
                    disabled={disabled}
                    onChange={(e) => setIncludeGmail(e.target.checked)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500/30"
                  />
                  <Mail size={14} className="text-slate-400" />
                  Include Gmail recap (15 recent messages, subjects + snippets)
                </label>

                <button
                  type="button"
                  disabled={
                    disabled ||
                    importBusy ||
                    (!selected.size && !sheetUrl.trim() && !includeCal && !includeGmail)
                  }
                  onClick={() => void runImport()}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition",
                    disabled ||
                      importBusy ||
                      (!selected.size && !sheetUrl.trim() && !includeCal && !includeGmail)
                      ? "bg-slate-100 text-slate-400"
                      : "bg-violet-600 text-white shadow-md shadow-violet-300/35 hover:bg-violet-700",
                  )}
                >
                  {importBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Add Workspace sources to session
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
      {/* Slack — coming soon */}
      <div className="rounded-[1.75rem] border border-dashed border-slate-200/90 bg-slate-50/50 p-5 ring-1 ring-slate-100/60">
        <div className="flex items-start gap-3 opacity-90">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
            <BrandImg src="/brand/slack.svg" className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Slack</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                <Lock size={10} />
                Soon
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Bot-based channel ingestion and slash commands will stream decisions and links into the brain. Webhook
              verification will use your Slack signing secret.
            </p>
          </div>
        </div>
      </div>

      {/* ElevenLabs + meetings pipeline */}
      <div className="rounded-[1.75rem] border border-slate-200/90 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950 p-5 text-white shadow-lg shadow-violet-900/20 ring-1 ring-white/10">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <BrandImg src="/brand/elevenlabs.svg" className="h-8 w-8" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">ElevenLabs · Meeting transcripts</h3>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-100 ring-1 ring-white/20">
                Webhook
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              Point your ElevenLabs (or any) transcription pipeline at this HTTPS endpoint. Payloads are verified when{" "}
              <span className="font-mono text-[10px] text-slate-200">MEETINGS_WEBHOOK_SECRET</span> is set—otherwise demo
              mode accepts JSON for local testing.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="block max-w-full truncate rounded-lg bg-black/35 px-2 py-1.5 font-mono text-[10px] text-violet-100 ring-1 ring-white/10">
                {meetingsWebhook}
              </code>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void copyText("meetings", meetingsWebhook)}
                className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/25 disabled:opacity-50"
              >
                {copied === "meetings" ? <Check size={12} /> : <Copy size={12} />}
                Copy URL
              </button>
              <a
                href="/api/ingest/meetings"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-200 hover:text-white"
              >
                Endpoint docs <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
