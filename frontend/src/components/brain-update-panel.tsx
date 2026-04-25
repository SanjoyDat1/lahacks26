"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FilePlus2,
  FileText,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  SkipForward,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

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
};

export type UpdateOp = {
  kind: string;
  target_file: string;
  target_section_id?: string | null;
  new_content?: string;
  reason: string;
  status: "planned" | "applied" | "failed";
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

export function BrainUpdatePanel({ onClose, onEvent, onDone }: Props) {
  const [docs, setDocs] = useState<UploadDoc[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ops, setOps] = useState<UpdateOp[]>([]);
  const [thinking, setThinking] = useState<string[]>([]);
  const [stage, setStage] = useState<string>("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

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

    if (event.type === "thinking") {
      setThinking((prev) => [...prev, event.content.trim()]);
      return;
    }
    if (event.type === "stage_start") {
      setStage(event.stage);
      return;
    }
    if (event.type === "op_planned") {
      setOps((prev) => [...prev, { ...event.op, status: "planned" }]);
      return;
    }
    if (event.type === "op_applied") {
      setOps((prev) =>
        prev.map((op) =>
          op.target_file === event.path
            ? { ...op, status: event.success ? "applied" : "failed" }
            : op,
        ),
      );
      return;
    }
    if (event.type === "done") {
      setIsDone(true);
      setIsRunning(false);
      onDone();
      return;
    }
    if (event.type === "error") {
      setError(event.message);
      setIsRunning(false);
    }
  }, [onEvent, onDone]);

  function runUpdate() {
    if (!docs.length || isRunning) return;
    setIsRunning(true);
    setIsDone(false);
    setError(null);
    setOps([]);
    setThinking(["Starting incremental brain update with new documents."]);
    setStage("normalize");

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = process.env.NEXT_PUBLIC_AGENT_WS_URL?.replace("/bootstrap/ws", "/update/ws")
      ?? `${protocol}://${window.location.hostname}:8000/update/ws`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        documents: docs.map(({ name, text, content_base64, mime_type, size }) => ({
          name, text, content_base64, mime_type, size,
        })),
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
      setError("Could not connect to update WebSocket. Make sure the agent API is running.");
      setIsRunning(false);
    };

    ws.onclose = () => {
      setIsRunning(false);
    };
  }

  const appliedCount = ops.filter((o) => o.status === "applied").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100">
            <Plus size={14} className="text-violet-600" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-800">Update Brain</p>
            <p className="text-[10px] text-slate-400">Add context from new documents</p>
          </div>
        </div>
        <button
          onClick={() => { socketRef.current?.close(); onClose(); }}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={Array.from(SUPPORTED_EXTENSIONS).join(",")}
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }}
        />

        {!isRunning && !isDone && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "rounded-2xl border border-dashed p-4 transition-all duration-300",
              isDragging ? "border-violet-400 bg-violet-50/60" : "border-slate-200/80 bg-slate-50/50",
            )}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl bg-white/80 px-4 py-6 transition hover:bg-white"
            >
              <Upload size={20} className="text-violet-500" />
              <p className="text-xs font-semibold text-slate-700">Drop files to add context</p>
              <p className="text-[10px] text-slate-400">.pdf .docx .md .txt .json .csv and more</p>
            </button>

            {docs.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2 rounded-xl bg-white/80 px-3 py-2">
                    <FileText size={12} className="text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{doc.name}</span>
                    {!isRunning && (
                      <button
                        onClick={() => setDocs((prev) => prev.filter((d) => d.id !== doc.id))}
                        className="text-slate-300 hover:text-slate-500"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isRunning && !isDone && docs.length > 0 && (
          <button
            onClick={runUpdate}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-violet-200/50 transition hover:bg-violet-700"
          >
            <Send size={13} />
            Update Brain with {docs.length} doc{docs.length === 1 ? "" : "s"}
          </button>
        )}

        {(isRunning || isDone) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2">
              {isDone ? (
                <CheckCircle2 size={14} className="text-emerald-500" />
              ) : (
                <Loader2 size={14} className="animate-spin text-violet-500" />
              )}
              <span className="text-xs font-medium text-slate-700">
                {isDone
                  ? `Done -- ${appliedCount} change${appliedCount === 1 ? "" : "s"} applied`
                  : STAGE_LABELS[stage] ?? "Processing..."}
              </span>
            </div>

            {ops.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Operations</p>
                {ops.map((op, i) => (
                  <div
                    key={`${op.target_file}-${op.kind}-${i}`}
                    className={cn(
                      "flex items-start gap-2 rounded-xl border px-3 py-2.5 transition-all duration-300",
                      op.status === "applied"
                        ? "border-emerald-200/60 bg-emerald-50/50"
                        : op.status === "failed"
                          ? "border-red-200/60 bg-red-50/50"
                          : "border-violet-200/60 bg-violet-50/30",
                    )}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <OpIcon kind={op.kind} status={op.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                          {op.kind.replace("_", " ")}
                        </span>
                        <ChevronRight size={9} className="text-slate-300" />
                        <span className="min-w-0 truncate font-mono text-[10px] text-slate-600">
                          {op.target_file}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">{op.reason}</p>
                    </div>
                    {op.status === "applied" && (
                      <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {thinking.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Agent Log</p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200/60 bg-slate-50/50 p-2">
                  {thinking.map((line, i) => (
                    <div key={i} className="flex gap-1.5 text-[10px] leading-4 text-slate-500">
                      <Sparkles size={9} className="mt-1 flex-shrink-0 text-violet-400" />
                      <span>{line}</span>
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200/60 bg-red-50/60 px-3 py-2 text-red-700">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <p className="text-[11px] leading-4">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OpIcon({ kind, status }: { kind: string; status: string }) {
  const cls = cn(
    "mt-0.5 flex-shrink-0",
    status === "applied" ? "text-emerald-500" : status === "failed" ? "text-red-400" : "text-violet-500",
  );
  if (kind === "append") return <Plus size={12} className={cls} />;
  if (kind === "supersede") return <RefreshCw size={12} className={cls} />;
  if (kind === "create_section") return <FilePlus2 size={12} className={cls} />;
  if (kind === "flag_conflict") return <AlertTriangle size={12} className={cls} />;
  if (kind === "ignore") return <SkipForward size={12} className={cls} />;
  return <PenLine size={12} className={cls} />;
}

const STAGE_LABELS: Record<string, string> = {
  idle: "Ready",
  normalize: "Reading documents...",
  distill: "Distilling context...",
  reconcile: "Reconciling with brain...",
  apply: "Applying changes...",
  verify: "Re-indexing retrieval...",
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}
