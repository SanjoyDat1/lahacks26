"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  GitBranch,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  SkipForward,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";

import {
  githubIngestFilename,
  githubReposForApi,
  type GithubRepoFormRow,
} from "@/lib/brain/github-ingest";
import { resolveAgentWsUrl } from "@/lib/agent-ws";
import { cn } from "@/lib/utils";

function newGithubRepoRow(): GithubRepoFormRow {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `gh-${Date.now()}`,
    url: "",
    ref: "",
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".pptx", ".xlsx", ".md", ".mdx", ".txt", ".rst",
  ".csv", ".json", ".yaml", ".yml", ".toml", ".py", ".js", ".jsx",
  ".ts", ".tsx", ".html", ".htm", ".xml", ".log", ".eml",
]);

const TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".csv", ".json", ".yaml", ".yml",
  ".toml", ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm",
  ".xml", ".log", ".eml",
]);

type UploadDoc = {
  id: string;
  name: string;
  text?: string;
  content_base64?: string;
  mime_type?: string;
  size: number;
  status: "pending" | "scanned" | "distilled";
};

export type UpdateOp = {
  kind: string;
  target_file: string;
  target_section_id?: string | null;
  new_content?: string;
  reason: string;
  status: "planned" | "active" | "applied" | "failed";
  change_type?: string;
};

export type UpdateEvent =
  | { type: "connected"; message: string }
  | { type: "stage_start"; stage: string; label: string }
  | { type: "thinking"; content: string }
  | { type: "document"; name: string; chars: number; status: string }
  | { type: "op_planned"; op: UpdateOp }
  | { type: "op_applied"; path: string; change_type: string; success: boolean }
  | { type: "directory_snapshot"; tree: unknown }
  | { type: "done"; ops_applied: number; files_touched: string[]; rationale: string }
  | { type: "error"; message: string };

interface Props {
  onClose: () => void;
  onEvent: (event: UpdateEvent) => void;
  onDone: () => void;
}

const STAGE_ORDER = ["normalize", "distill", "reconcile", "apply", "verify"] as const;
type Stage = typeof STAGE_ORDER[number];

const STAGE_LABELS: Record<Stage, string> = {
  normalize: "Read docs",
  distill:   "Extract facts",
  reconcile: "Reconcile",
  apply:     "Apply",
  verify:    "Re-index",
};

// ── Component ──────────────────────────────────────────────────────────────────

export function BrainUpdatePanel({ onClose, onEvent, onDone }: Props) {
  const [docs, setDocs] = useState<UploadDoc[]>([]);
  const [githubRepos, setGithubRepos] = useState<GithubRepoFormRow[]>(() => [newGithubRepoRow()]);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<Stage | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<Stage>>(new Set());
  const [ops, setOps] = useState<UpdateOp[]>([]);
  const [thinking, setThinking] = useState<string[]>([]);
  const [summary, setSummary] = useState<{ opsApplied: number; files: string[]; rationale: string } | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  /** Ingest filename (e.g. `github-owner-repo.md`) → scan status for GitHub-sourced docs */
  const [githubIngestStatus, setGithubIngestStatus] = useState<Record<string, UploadDoc["status"]>>({});

  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const opsEndRef = useRef<HTMLDivElement>(null);
  const mountedOpsRef = useRef<Set<string>>(new Set());

  const githubApiList = githubReposForApi(githubRepos);
  const hasUpdateSource = docs.length > 0 || githubApiList.length > 0;

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thinking.length]);

  useEffect(() => {
    opsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ops.length]);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    setError(null);
    const files = Array.from(fileList);
    const nextDocs: UploadDoc[] = [];
    for (const file of files) {
      const ext = file.name.lastIndexOf(".") === -1 ? "" : file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const isText = TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/");
      const text = isText ? await file.text() : undefined;
      const contentBase64 = isText ? undefined : await readFileAsDataUrl(file);
      if (isText && !text?.trim()) continue;
      nextDocs.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        text,
        content_base64: contentBase64,
        mime_type: file.type,
        size: file.size,
        status: "pending",
      });
    }
    if (nextDocs.length) setDocs((prev) => [...prev, ...nextDocs]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    void addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleEvent = useCallback((event: UpdateEvent) => {
    onEvent(event);

    if (event.type === "stage_start") {
      const stage = event.stage as Stage;
      setCurrentStage(stage);
      setCompletedStages((prev) => {
        const next = new Set(prev);
        const idx = STAGE_ORDER.indexOf(stage);
        STAGE_ORDER.slice(0, idx).forEach((s) => next.add(s));
        return next;
      });
      return;
    }

    if (event.type === "thinking") {
      setThinking((prev) => {
        const lines = event.content.trim().split("\n").filter(Boolean);
        return [...prev, ...lines];
      });
      return;
    }

    if (event.type === "document") {
      setDocs((prev) =>
        prev.map((d) =>
          d.name === event.name
            ? { ...d, status: event.status === "distilled" ? "distilled" : "scanned" }
            : d,
        ),
      );
      setGithubIngestStatus((prev) => {
        if (event.name in prev) {
          return {
            ...prev,
            [event.name]: event.status === "distilled" ? "distilled" : "scanned",
          };
        }
        return prev;
      });
      return;
    }

    if (event.type === "op_planned") {
      const key = `${event.op.target_file}-${event.op.kind}`;
      setOps((prev) => {
        if (prev.some((o) => o.target_file === event.op.target_file && o.kind === event.op.kind)) return prev;
        return [...prev, { ...event.op, status: "planned" }];
      });
      // Trigger mount animation after next paint
      requestAnimationFrame(() => {
        setTimeout(() => { mountedOpsRef.current.add(key); }, 16);
      });
      return;
    }

    if (event.type === "op_applied") {
      setOps((prev) =>
        prev.map((op) =>
          op.target_file === event.path
            ? { ...op, status: event.success ? "applied" : "failed", change_type: event.change_type }
            : op,
        ),
      );
      return;
    }

    if (event.type === "done") {
      setPhase("done");
      setCurrentStage(null);
      setCompletedStages(new Set(STAGE_ORDER));
      setSummary({
        opsApplied: event.ops_applied,
        files: event.files_touched,
        rationale: event.rationale,
      });
      onDone();
      return;
    }

    if (event.type === "error") {
      setError(event.message);
      setPhase("idle");
    }
  }, [onEvent, onDone]);

  function runUpdate() {
    if (!hasUpdateSource || phase === "running") return;
    setPhase("running");
    setError(null);
    setOps([]);
    setThinking([]);
    setSummary(null);
    setCurrentStage(null);
    setCompletedStages(new Set());
    mountedOpsRef.current = new Set();
    setDocs((prev) => prev.map((d) => ({ ...d, status: "pending" })));
    const ghMap: Record<string, UploadDoc["status"]> = {};
    for (const r of githubRepos) {
      const u = r.url.trim();
      if (u) ghMap[githubIngestFilename(u)] = "pending";
    }
    setGithubIngestStatus(ghMap);

    const wsUrl = resolveAgentWsUrl("/update/ws");

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        documents: docs.map(({ name, text, content_base64, mime_type, size }) => ({
          name, text, content_base64, mime_type, size,
        })),
        github_repos: githubApiList,
        clone_timeout_s: 300,
        update_mode: "llm",
      }));
    };

    ws.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as UpdateEvent;
        handleEvent(event);
      } catch { /* ignore */ }
    };

    ws.onerror = () => {
      setError("Could not connect to the agent API. Make sure it is running on port 8000.");
      setPhase("idle");
    };

    ws.onclose = () => {
      setPhase((p) => p === "running" ? "idle" : p);
    };
  }

  const appliedCount = ops.filter((o) => o.status === "applied").length;
  const failedCount = ops.filter((o) => o.status === "failed").length;

  return (
    <>
      <style>{`
        @keyframes upSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .op-enter { animation: upSlideIn 0.28s cubic-bezier(.16,1,.3,1) both; }
        @keyframes statusPulse {
          0%,100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .status-active { animation: statusPulse 1.2s ease-in-out infinite; }
      `}</style>

      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100">
              <Zap size={13} className="text-violet-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-800">Update Brain</p>
              <p className="text-[10px] text-slate-400">
                {phase === "running"
                  ? "Processing new context…"
                  : phase === "done"
                    ? "Brain updated"
                    : "Add files and/or a public GitHub repo"}
              </p>
            </div>
          </div>
          <button
            onClick={() => { socketRef.current?.close(); onClose(); }}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* ── Stage pipeline ───────────────────────────────────────────────── */}
          {(phase === "running" || phase === "done") && (
            <div className="rounded-2xl border border-slate-200/60 bg-white/70 p-3">
              <div className="flex items-center justify-between">
                {STAGE_ORDER.map((stage, i) => {
                  const done = completedStages.has(stage);
                  const active = currentStage === stage;
                  return (
                    <div key={stage} className="flex items-center gap-1">
                      <div className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-500",
                        done ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                          : active ? "bg-violet-600 text-white shadow-sm shadow-violet-200"
                          : "bg-slate-100 text-slate-400",
                      )}>
                        {done ? <CheckCircle2 size={11} /> : active ? <Loader2 size={10} className="animate-spin" /> : i + 1}
                      </div>
                      <span className={cn(
                        "text-[9px] font-medium transition-colors duration-300",
                        done ? "text-emerald-600" : active ? "text-violet-700" : "text-slate-400",
                      )}>
                        {STAGE_LABELS[stage]}
                      </span>
                      {i < STAGE_ORDER.length - 1 && (
                        <div className={cn(
                          "mx-1 h-px w-4 rounded-full transition-all duration-500",
                          done ? "bg-emerald-400" : "bg-slate-200",
                        )} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── File drop zone (idle only) ────────────────────────────────── */}
          {phase === "idle" && (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept={Array.from(SUPPORTED_EXTENSIONS).join(",")}
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }}
              />

              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white">
                    <GitBranch size={12} />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-700">GitHub repository</p>
                    <p className="text-[9px] text-slate-400">Point at a codebase; no uploads required. Add files below only for extra context.</p>
                  </div>
                </div>
                {githubRepos.map((row, index) => (
                  <div key={row.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
                    <label className="block min-w-0 flex-1">
                      <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        URL {githubRepos.length > 1 ? `#${index + 1}` : ""}
                      </span>
                      <input
                        type="url"
                        placeholder="https://github.com/owner/repo"
                        value={row.url}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGithubRepos((prev) => prev.map((r) => (r.id === row.id ? { ...r, url: v } : r)));
                        }}
                        className="w-full rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-[11px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/25"
                      />
                    </label>
                    <label className="block w-full sm:w-28">
                      <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Branch</span>
                      <input
                        type="text"
                        placeholder="main"
                        value={row.ref}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGithubRepos((prev) => prev.map((r) => (r.id === row.id ? { ...r, ref: v } : r)));
                        }}
                        className="w-full rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-[11px] outline-none focus:ring-2 focus:ring-violet-500/25"
                      />
                    </label>
                    {githubRepos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setGithubRepos((prev) => prev.filter((r) => r.id !== row.id))}
                        className="rounded-lg border border-slate-200/80 px-2 py-1.5 text-[10px] text-slate-500 hover:bg-white"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {githubRepos.length < 4 && (
                  <button
                    type="button"
                    onClick={() => setGithubRepos((prev) => [...prev, newGithubRepoRow()])}
                    className="text-[10px] font-semibold text-violet-600 hover:text-violet-800"
                  >
                    + Another repo
                  </button>
                )}
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={cn(
                  "rounded-2xl border border-dashed transition-all duration-300",
                  isDragging ? "border-violet-400 bg-violet-50/70 scale-[1.01]" : "border-slate-200/80 bg-slate-50/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl px-4 py-7 transition hover:bg-white/60"
                >
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-300",
                    isDragging ? "bg-violet-100 scale-110" : "bg-white/80 border border-slate-200/60",
                  )}>
                    <Upload size={18} className={isDragging ? "text-violet-600" : "text-slate-400"} />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">Extra files (optional)</p>
                  <p className="text-[10px] text-slate-400">Skip if the repo URL above is enough — .pdf .docx .md .txt and more</p>
                </button>

                {(docs.length > 0 || githubApiList.length > 0) && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {githubRepos
                      .filter((r) => r.url.trim())
                      .map((r) => (
                        <div key={r.id} className="flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 border border-slate-100/60">
                          <GitBranch size={11} className="flex-shrink-0 text-slate-600" />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600 font-mono">
                            {githubIngestFilename(r.url)}
                          </span>
                          <span className="text-[9px] text-slate-400">GitHub</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setGithubRepos((prev) => prev.filter((x) => x.id !== r.id));
                            }}
                            className="text-slate-300 hover:text-slate-500 transition"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    {docs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2 border border-slate-100/60">
                        <FileText size={11} className="flex-shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{doc.name}</span>
                        <span className="text-[9px] text-slate-400">{formatBytes(doc.size)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDocs((prev) => prev.filter((d) => d.id !== doc.id)); }}
                          className="text-slate-300 hover:text-slate-500 transition"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Document status cards (running) ──────────────────────────── */}
          {phase !== "idle" && (docs.length > 0 || githubApiList.length > 0) && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Sources</p>
              {githubRepos
                .filter((r) => r.url.trim())
                .map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2">
                    <GitBranch size={11} className="flex-shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600 font-mono">{githubIngestFilename(r.url)}</span>
                    <DocStatusBadge status={githubIngestStatus[githubIngestFilename(r.url)] ?? "pending"} />
                  </div>
                ))}
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2">
                  <FileText size={11} className="flex-shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{doc.name}</span>
                  <DocStatusBadge status={doc.status} />
                </div>
              ))}
            </div>
          )}

          {/* ── Thinking log ─────────────────────────────────────────────── */}
          {thinking.length > 0 && (
            <div className="rounded-2xl border border-slate-200/60 bg-slate-50/60 overflow-hidden">
              <button
                onClick={() => setThinkingOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-100/60 transition"
              >
                <Sparkles size={10} className="flex-shrink-0 text-violet-400" />
                <span className="flex-1 text-[10px] font-semibold text-slate-500">Agent reasoning</span>
                <span className="text-[9px] text-slate-400">{thinking.length} lines</span>
                {thinkingOpen ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronRight size={10} className="text-slate-400" />}
              </button>
              {thinkingOpen && (
                <div className="max-h-36 overflow-y-auto border-t border-slate-200/60 p-2.5 space-y-1">
                  {thinking.map((line, i) => (
                    <p
                      key={i}
                      className="text-[10px] leading-4 text-slate-500 op-enter"
                      style={{ animationDelay: `${Math.min(i * 0.03, 0.5)}s` }}
                    >
                      {line}
                    </p>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          )}

          {/* ── Operations ───────────────────────────────────────────────── */}
          {ops.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Operations</p>
                <div className="flex items-center gap-2">
                  {appliedCount > 0 && (
                    <span className="text-[9px] font-semibold text-emerald-600">
                      {appliedCount} applied
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="text-[9px] font-semibold text-red-500">
                      {failedCount} failed
                    </span>
                  )}
                  {phase === "running" && ops.length > 0 && (
                    <span className="text-[9px] text-slate-400">
                      {ops.filter((o) => o.status !== "planned").length}/{ops.length}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {phase === "running" && ops.length > 0 && (
                <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
                    style={{ width: `${(ops.filter((o) => o.status !== "planned").length / ops.length) * 100}%` }}
                  />
                </div>
              )}

              <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-0.5">
                {ops.map((op, i) => (
                  <div
                    key={`${op.target_file}-${op.kind}-${i}`}
                    className={cn(
                      "op-enter flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-400",
                      op.status === "applied"
                        ? "border-emerald-200/70 bg-emerald-50/60"
                        : op.status === "failed"
                          ? "border-red-200/70 bg-red-50/60"
                          : op.status === "active"
                            ? "border-amber-300/70 bg-amber-50/70 shadow-sm"
                            : "border-slate-200/60 bg-white/70",
                    )}
                    style={{ animationDelay: `${Math.min(i * 0.06, 1.0)}s` }}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      <OpIcon kind={op.kind} status={op.status} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <KindBadge kind={op.kind} />
                        <span className="min-w-0 truncate font-mono text-[10px] text-slate-600">
                          {op.target_file}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-[1.45] text-slate-500 line-clamp-2">{op.reason}</p>
                    </div>
                    <div className="flex-shrink-0 mt-0.5">
                      {op.status === "applied" && <CheckCircle2 size={12} className="text-emerald-500" />}
                      {op.status === "failed" && <AlertTriangle size={12} className="text-red-400" />}
                      {op.status === "active" && <Loader2 size={12} className="animate-spin text-amber-500 status-active" />}
                      {op.status === "planned" && <div className="h-2 w-2 rounded-full bg-slate-200" />}
                    </div>
                  </div>
                ))}
                <div ref={opsEndRef} />
              </div>
            </div>
          )}

          {/* ── Done summary ─────────────────────────────────────────────── */}
          {phase === "done" && summary && (
            <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-green-50/60 p-4 op-enter">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500 shadow-sm">
                  <CheckCircle2 size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-800">Brain updated</p>
                  <p className="text-[10px] text-emerald-600">
                    {summary.opsApplied} change{summary.opsApplied !== 1 ? "s" : ""} across {summary.files.length} file{summary.files.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              {summary.files.length > 0 && (
                <div className="space-y-1 mb-3">
                  {summary.files.slice(0, 6).map((f) => (
                    <div key={f} className="flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1">
                      <FileText size={9} className="flex-shrink-0 text-emerald-500" />
                      <span className="truncate font-mono text-[10px] text-slate-600">{f}</span>
                    </div>
                  ))}
                  {summary.files.length > 6 && (
                    <p className="text-[9px] text-slate-400 pl-2">+{summary.files.length - 6} more</p>
                  )}
                </div>
              )}
              {summary.rationale && (
                <p className="text-[10px] leading-4 text-emerald-700/80 italic">{summary.rationale.slice(0, 200)}</p>
              )}
              <button
                onClick={() => {
                  setPhase("idle");
                  setOps([]);
                  setThinking([]);
                  setSummary(null);
                  setDocs([]);
                  setGithubRepos([newGithubRepoRow()]);
                  setGithubIngestStatus({});
                  setCompletedStages(new Set());
                }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200/60 bg-white/70 px-3 py-2 text-[11px] font-medium text-emerald-700 transition hover:bg-white"
              >
                <Plus size={11} /> Add more context
              </button>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200/60 bg-red-50/70 px-3 py-2.5 text-red-700 op-enter">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[11px] font-semibold">Error</p>
                <p className="text-[10px] leading-4 mt-0.5">{error}</p>
                {error.includes("connect") && (
                  <code className="mt-1.5 block rounded-lg bg-white/70 px-2 py-1 font-mono text-[9px] text-slate-600">
                    cd agent &amp;&amp; uv run brain-api
                  </code>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer / Send button ───────────────────────────────────────── */}
        {phase === "idle" && hasUpdateSource && (
          <div className="border-t border-slate-200/60 p-4">
            <button
              onClick={runUpdate}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-violet-200/60 transition hover:bg-violet-700 active:scale-[0.98]"
            >
              <Send size={12} />
              Update brain with {docs.length + githubApiList.length} source{docs.length + githubApiList.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DocStatusBadge({ status }: { status: UploadDoc["status"] }) {
  if (status === "distilled") return (
    <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
      <CheckCircle2 size={8} /> distilled
    </span>
  );
  if (status === "scanned") return (
    <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-700">
      <CheckCircle2 size={8} /> scanned
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500">
      <Loader2 size={8} className="animate-spin" /> reading
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    append:         "bg-blue-100 text-blue-700",
    supersede:      "bg-amber-100 text-amber-700",
    create_section: "bg-violet-100 text-violet-700",
    flag_conflict:  "bg-red-100 text-red-700",
    ignore:         "bg-slate-100 text-slate-500",
  };
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide", map[kind] ?? "bg-slate-100 text-slate-500")}>
      {kind.replace("_", " ")}
    </span>
  );
}

function OpIcon({ kind, status }: { kind: string; status: string }) {
  const cls = cn(
    status === "applied" ? "text-emerald-500" : status === "failed" ? "text-red-400" : status === "active" ? "text-amber-500" : "text-slate-400",
  );
  const size = 12;
  if (kind === "append")         return <Plus size={size} className={cls} />;
  if (kind === "supersede")      return <RefreshCw size={size} className={cls} />;
  if (kind === "create_section") return <FilePlus2 size={size} className={cls} />;
  if (kind === "flag_conflict")  return <AlertTriangle size={size} className={cls} />;
  if (kind === "ignore")         return <SkipForward size={size} className={cls} />;
  return <PenLine size={size} className={cls} />;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
