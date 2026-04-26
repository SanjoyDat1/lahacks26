"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
  Zap,
} from "lucide-react";

import { resolveAgentWsUrl } from "@/lib/agent-ws";
import { cn } from "@/lib/utils";

type RebuildEvent =
  | { type: "connected"; message: string; active_run_id?: string | null }
  | { type: "rebuild_started"; run_id: string; ts_ms?: number; meta?: any; replay?: boolean }
  | { type: "stage_start"; run_id?: string; stage: string; label?: string; replay?: boolean }
  | { type: "thinking"; run_id?: string; content: string; replay?: boolean }
  | { type: "document"; run_id?: string; name: string; chars: number; status: string; replay?: boolean }
  | { type: "op_planned"; run_id?: string; op: { kind: string; target_file: string; reason: string }; replay?: boolean }
  | { type: "op_applied"; run_id?: string; path: string; change_type: string; success: boolean; replay?: boolean }
  | { type: "index_invalidate" | "index_invalidated"; run_id?: string; label?: string; replay?: boolean }
  | { type: "done"; run_id: string; ops_applied?: number; files_touched?: string[]; rationale?: string; replay?: boolean }
  | { type: "error"; run_id?: string; message: string; replay?: boolean }
  | { type: "rebuild_end"; run_id: string; status: string; summary?: any; replay?: boolean }
  | { type: string; run_id?: string; replay?: boolean; [k: string]: any };

function isTerminal(evt: RebuildEvent) {
  return evt.type === "done" || evt.type === "error" || evt.type === "rebuild_end";
}

export function ContextMapRebuildNotifier({
  onRebuildDone,
}: {
  onRebuildDone?: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<RebuildEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [lastMessage, setLastMessage] = useState<string>("Waiting for rebuild events…");

  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, expanded]);

  useEffect(() => {
    const wsUrl = resolveAgentWsUrl("/context-map/ws");
    // Debug: verify we're actually connecting in the browser.
    console.info("[ctxmap] ws connect", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.info("[ctxmap] ws open");
    };

    ws.onmessage = (msg) => {
      let evt: RebuildEvent | null = null;
      try {
        evt = JSON.parse(msg.data) as RebuildEvent;
      } catch {
        return;
      }
      if (!evt) return;

      const rid = "run_id" in evt ? (evt as any).run_id : null;
      const replay = "replay" in evt ? Boolean((evt as any).replay) : false;
      console.debug("[ctxmap] ws event", evt.type, rid, replay ? "(replay)" : "");
      setEvents((prev) => [...prev, evt!]);

      if (evt.type === "connected") {
        setLastMessage(evt.message);
        if (evt.active_run_id) {
          setActiveRunId(evt.active_run_id);
          setStatus("running");
          setOpen(true);
        }
        return;
      }

      if (evt.type === "rebuild_started") {
        setActiveRunId(String(evt.run_id ?? ""));
        setStatus("running");
        setLastMessage("Context map is updating…");
        setOpen(true);
        return;
      }

      if (evt.type === "thinking") {
        const line = evt.content.trim().split("\n").filter(Boolean).at(-1);
        if (line) setLastMessage(line.slice(0, 140));
        return;
      }

      if (evt.type === "error") {
        setStatus("error");
        setOpen(true);
        setLastMessage(evt.message.slice(0, 160));
        return;
      }

      if (evt.type === "done" || evt.type === "rebuild_end") {
        setStatus("done");
        setOpen(true);
        setLastMessage("Context map updated.");
        const rid = evt.type === "done" ? evt.run_id : evt.run_id;
        if (typeof onRebuildDone === "function") onRebuildDone(String(rid ?? ""));
        return;
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setOpen(true);
      setLastMessage("Could not connect to rebuild stream (agent API offline?).");
      console.warn("[ctxmap] ws error");
    };

    ws.onclose = () => {
      console.info("[ctxmap] ws close");
    };

    return () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, []);

  const stageLabel = useMemo(() => {
    const lastStage = [...events].reverse().find((e) => e.type === "stage_start") as
      | Extract<RebuildEvent, { type: "stage_start" }>
      | undefined;
    if (!lastStage) return null;
    return lastStage.label ?? lastStage.stage;
  }, [events]);

  const hasAnyRun = open && (status !== "idle" || events.length > 0);
  if (!hasAnyRun) return null;

  return (
    <div className="fixed right-4 top-4 z-[120]">
      {/* Pop-up chip */}
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "glass w-[340px] rounded-2xl border px-4 py-3 text-left shadow-lg",
            status === "error"
              ? "border-red-200/70"
              : status === "done"
                ? "border-emerald-200/70"
                : "border-violet-200/70",
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl",
                status === "error"
                  ? "bg-red-500/10 text-red-600"
                  : status === "done"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-violet-500/10 text-violet-700",
              )}
            >
              {status === "running" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : status === "error" ? (
                <AlertTriangle size={16} />
              ) : (
                <Zap size={16} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-black/80">
                {status === "running"
                  ? "Context map updating"
                  : status === "error"
                    ? "Context map update failed"
                    : "Context map updated"}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-black/50">
                {stageLabel ? `${stageLabel} · ` : ""}{lastMessage}
              </p>
              {activeRunId ? (
                <p className="mt-1 font-mono text-[9px] text-black/35">
                  run: {activeRunId}
                </p>
              ) : null}
            </div>
            <ChevronRight size={14} className="mt-1 text-black/35" />
          </div>
        </button>
      )}

      {/* Expanded log viewer */}
      {expanded && (
        <div className="glass w-[520px] overflow-hidden rounded-2xl border border-black/10 shadow-2xl">
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
            <div className="flex items-center gap-2">
              {status === "running" ? (
                <Loader2 size={14} className="animate-spin text-violet-600" />
              ) : status === "error" ? (
                <AlertTriangle size={14} className="text-red-500" />
              ) : (
                <CheckCircle2 size={14} className="text-emerald-600" />
              )}
              <p className="text-[11px] font-semibold text-black/80">
                Context-map rebuild logs
              </p>
              {activeRunId ? (
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[9px] text-black/50">
                  {activeRunId}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-lg p-1.5 text-black/40 transition hover:bg-black/[0.05] hover:text-black/70"
                title="Collapse"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  setOpen(false);
                }}
                className="rounded-lg p-1.5 text-black/40 transition hover:bg-black/[0.05] hover:text-black/70"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto px-4 py-3">
            <div className="space-y-1.5 font-mono text-[10px] leading-4 text-black/70">
              {events
                .filter((e) => !("run_id" in e) || !activeRunId || (e as { run_id?: string }).run_id === activeRunId)
                .slice(-320)
                .map((e, i) => (
                  <LogLine key={i} evt={e} />
                ))}
              <div ref={logEndRef} />
            </div>
          </div>

          <div className="border-t border-black/10 px-4 py-3 text-[10px] text-black/50">
            Click the small popup to reopen logs while a rebuild is running.
          </div>
        </div>
      )}
    </div>
  );
}

function LogLine({ evt }: { evt: RebuildEvent }) {
  if (evt.type === "stage_start") {
    return (
      <div className="rounded-lg bg-black/[0.04] px-2 py-1 text-black/80">
        <span className="font-sans text-[10px] font-semibold">Stage</span>{" "}
        {evt.stage}
        {evt.label ? ` — ${evt.label}` : ""}
      </div>
    );
  }
  if (evt.type === "thinking") {
    const line = evt.content.trim().split("\n").filter(Boolean).at(-1) ?? evt.content.trim();
    return <div className="text-black/60">💭 {line}</div>;
  }
  if (evt.type === "op_planned") {
    return <div className="text-black/65">📝 plan {evt.op.kind} → {evt.op.target_file}</div>;
  }
  if (evt.type === "op_applied") {
    return (
      <div className={cn(evt.success ? "text-emerald-700/80" : "text-red-700/80")}>
        {evt.success ? "✓" : "✗"} apply {evt.change_type} → {evt.path}
      </div>
    );
  }
  if (evt.type === "index_invalidate" || evt.type === "index_invalidated") {
    return <div className="text-violet-700/70">↻ {evt.type}</div>;
  }
  if (evt.type === "done") {
    return <div className="text-emerald-700/80">✓ done</div>;
  }
  if (evt.type === "error") {
    return <div className="text-red-700/80">✗ error: {evt.message}</div>;
  }
  if (evt.type === "rebuild_started") {
    return <div className="text-violet-700/70">▶ rebuild started</div>;
  }
  if (evt.type === "rebuild_end") {
    return <div className="text-emerald-700/80">■ rebuild end ({evt.status})</div>;
  }

  if (isTerminal(evt)) return <div className="text-black/60">{evt.type}</div>;
  return <div className="text-black/40">{evt.type}</div>;
}

