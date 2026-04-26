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
  | { type: "graph_step"; phase: string; edge: string; node: string; label: string; run_id?: string; replay?: boolean }
  | { type: "agent_start"; agent: string; run_id?: string; replay?: boolean }
  | { type: "agent_end"; agent: string; text: string; run_id?: string; replay?: boolean }
  | { type: "tool_call"; agent: string; tool: string; input?: Record<string, unknown>; summary?: string; run_id?: string; replay?: boolean }
  | { type: "tool_result"; agent: string; tool: string; output: string; run_id?: string; replay?: boolean }
  | { type: "token"; agent: string; content: string; run_id?: string; replay?: boolean }
  | { type: "thinking"; run_id?: string; content: string; agent?: string; replay?: boolean }
  | { type: "document"; run_id?: string; name: string; chars: number; status: string; replay?: boolean }
  | { type: "op_planned"; run_id?: string; op: { kind: string; target_file: string; reason: string }; replay?: boolean }
  | { type: "op_applied"; run_id?: string; path: string; change_type: string; success: boolean; replay?: boolean }
  | { type: "index_invalidate" | "index_invalidated"; run_id?: string; label?: string; replay?: boolean }
  | { type: "done"; run_id?: string; result?: string; ops_applied?: number; files_touched?: string[]; rationale?: string; replay?: boolean }
  | { type: "error"; run_id?: string; message: string; replay?: boolean }
  | { type: "rebuild_end"; run_id: string; status: string; summary?: any; replay?: boolean }
  | { type: string; run_id?: string; replay?: boolean; [k: string]: any };

type DisplayRow =
  | { kind: "event"; evt: RebuildEvent }
  | { kind: "tokens"; agent: string; text: string };

function reduceTokensForDisplay(events: RebuildEvent[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  let buf = "";
  let bufAgent = "";
  const flush = () => {
    if (!buf) return;
    out.push({ kind: "tokens", agent: bufAgent || "?", text: buf });
    buf = "";
    bufAgent = "";
  };
  for (const evt of events) {
    if (evt.type === "token") {
      const agent = String((evt as { agent?: string }).agent ?? "?");
      const content = String((evt as { content?: string }).content ?? "");
      if (buf && bufAgent !== agent) flush();
      bufAgent = agent;
      buf += content;
    } else {
      flush();
      out.push({ kind: "event", evt });
    }
  }
  flush();
  return out;
}

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
  /** Avoid putting `onRebuildDone` in the WS effect deps: parents often pass inline lambdas and re-render frequently. */
  const onRebuildDoneRef = useRef<typeof onRebuildDone>(onRebuildDone);
  onRebuildDoneRef.current = onRebuildDone;

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
      // History replay is for the expanded log only — do not drive toast status
      // (stale `error` / `done` from past runs was showing "failed" on every /brain load).
      if (replay) return;

      if (evt.type === "connected") {
        setLastMessage(evt.message);
        // Do NOT auto-open the popup on stream connection. The agent may report
        // an `active_run_id` from a stale/previous run; we only want the toast
        // to appear when there's real rebuild activity (rebuild_started / error
        // / done). If a rebuild is genuinely in-flight, those events will arrive
        // immediately after connection and open the popup then.
        if (evt.active_run_id) {
          setActiveRunId(evt.active_run_id);
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

      if (evt.type === "graph_step") {
        const arrow = evt.edge === "enter" ? "→" : "←";
        setLastMessage(`${arrow} [${evt.phase}] ${evt.label}`.slice(0, 160));
        return;
      }

      if (evt.type === "agent_start") {
        setLastMessage(`${evt.agent} agent starting…`);
        return;
      }

      if (evt.type === "agent_end") {
        const preview = evt.text.replace(/\s+/g, " ").trim().slice(0, 120);
        setLastMessage(`${evt.agent} finished: ${preview}${evt.text.length > 120 ? "…" : ""}`);
        return;
      }

      if (evt.type === "tool_call") {
        const s = evt.summary?.trim();
        setLastMessage(`⚙ ${evt.agent} · ${evt.tool}${s ? ` — ${s}` : ""}`.slice(0, 160));
        return;
      }

      if (evt.type === "tool_result") {
        const n = evt.output?.length ?? 0;
        setLastMessage(`✓ ${evt.agent} · ${evt.tool} (${n} chars)`.slice(0, 160));
        return;
      }

      if (evt.type === "error") {
        setStatus("error");
        setOpen(true);
        const m =
          typeof (evt as { message?: string }).message === "string"
            ? (evt as { message: string }).message.trim()
            : "";
        setLastMessage((m || "Context map rebuild failed.").slice(0, 160));
        return;
      }

      if (evt.type === "rebuild_end") {
        const st = String((evt as { status?: string }).status ?? "");
        if (st === "error") {
          setStatus("error");
          setOpen(true);
          const summ = (evt as { summary?: { message?: string } }).summary;
          const msg =
            typeof summ?.message === "string" && summ.message.trim()
              ? summ.message.trim()
              : "Context map rebuild ended with an error.";
          setLastMessage(msg.slice(0, 160));
          return;
        }
        setStatus("done");
        setOpen(true);
        setLastMessage("Context map updated.");
        const rid =
          "run_id" in evt && evt.run_id != null ? String(evt.run_id) : "";
        const cb = onRebuildDoneRef.current;
        if (typeof cb === "function") cb(rid);
        return;
      }

      if (evt.type === "done") {
        setStatus("done");
        setOpen(true);
        setLastMessage("Context map updated.");
        const rid =
          "run_id" in evt && evt.run_id != null ? String(evt.run_id) : "";
        const cb = onRebuildDoneRef.current;
        if (typeof cb === "function") cb(rid);
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

  const filteredEvents = useMemo(() => {
    return events.filter(
      (e) =>
        !activeRunId ||
        !("run_id" in e) ||
        (e as { run_id?: string }).run_id === activeRunId,
    );
  }, [events, activeRunId]);

  const displayRows = useMemo(
    () => reduceTokensForDisplay(filteredEvents.slice(-400)),
    [filteredEvents],
  );

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
              {displayRows.map((row, i) =>
                row.kind === "tokens" ? (
                  <TokenBlock key={`t-${i}`} agent={row.agent} text={row.text} />
                ) : (
                  <LogLine key={`e-${i}-${row.evt.type}`} evt={row.evt} />
                ),
              )}
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

function TokenBlock({ agent, text }: { agent: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = text.length > 280 && !expanded;
  const shown = collapsed ? `${text.slice(0, 280)}…` : text;
  return (
    <div className="rounded-lg border border-violet-200/50 bg-violet-50/40 px-2 py-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 text-left"
      >
        {expanded ? <ChevronDown size={10} className="text-violet-500" /> : <ChevronRight size={10} className="text-violet-500" />}
        <span className="font-sans text-[9px] font-semibold uppercase tracking-wide text-violet-700">
          Model stream · {agent}
        </span>
        <span className="text-[9px] text-black/40">({text.length} chars)</span>
      </button>
      <pre
        className={cn(
          "mt-1 whitespace-pre-wrap break-words text-[9px] leading-relaxed text-black/70",
          expanded ? "max-h-56 overflow-y-auto" : "max-h-20 overflow-hidden",
        )}
      >
        {shown}
      </pre>
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
    const who = "agent" in evt && evt.agent ? `${evt.agent} · ` : "";
    return <div className="text-black/60">💭 {who}{line}</div>;
  }
  if (evt.type === "graph_step") {
    const arrow = evt.edge === "enter" ? "→" : "←";
    const tone =
      evt.phase === "writer" ? "border-amber-200/70 bg-amber-50/50" : "border-sky-200/70 bg-sky-50/50";
    return (
      <div className={cn("rounded-lg border px-2 py-1 font-sans text-[10px] text-black/80", tone)}>
        <span className="font-semibold text-black/55">{arrow}</span>{" "}
        <span className="font-mono text-[9px] uppercase text-black/45">{evt.phase}</span>{" "}
        <span className="font-medium">{evt.label}</span>
        <span className="ml-1 font-mono text-[9px] text-black/35">({evt.node})</span>
      </div>
    );
  }
  if (evt.type === "agent_start") {
    return (
      <div className="rounded-lg bg-black/[0.06] px-2 py-1 font-sans text-[10px] font-semibold text-black/75">
        ▶ {evt.agent} agent
      </div>
    );
  }
  if (evt.type === "agent_end") {
    const t = evt.text.replace(/\s+/g, " ").trim();
    return (
      <div className="rounded-lg border border-black/10 bg-white/60 px-2 py-1.5">
        <p className="font-sans text-[9px] font-semibold text-black/60">■ {evt.agent} agent</p>
        {t ? (
          <p className="mt-0.5 text-[9px] leading-relaxed text-black/65">{t.slice(0, 500)}{t.length > 500 ? "…" : ""}</p>
        ) : null}
      </div>
    );
  }
  if (evt.type === "tool_call") {
    const summary = evt.summary?.trim();
    return (
      <div className="rounded-lg border border-amber-200/60 bg-amber-50/60 px-2 py-1">
        <p className="font-sans text-[9px] font-semibold text-amber-900">
          ⚙ {evt.agent} · <span className="font-mono">{evt.tool}</span>
        </p>
        {summary ? <p className="mt-0.5 font-mono text-[9px] text-amber-800/90">{summary}</p> : null}
      </div>
    );
  }
  if (evt.type === "tool_result") {
    const out = evt.output?.slice(0, 600) ?? "";
    const more = (evt.output?.length ?? 0) > 600;
    return (
      <div className="rounded-lg border border-emerald-200/50 bg-emerald-50/40 px-2 py-1">
        <p className="font-sans text-[9px] font-semibold text-emerald-900">
          ✓ {evt.agent} · <span className="font-mono">{evt.tool}</span>
        </p>
        {out ? (
          <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[9px] text-emerald-900/80">
            {out}{more ? "…" : ""}
          </pre>
        ) : null}
      </div>
    );
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
    const result = typeof (evt as { result?: string }).result === "string" ? (evt as { result: string }).result : null;
    const ops = (evt as { ops_applied?: number }).ops_applied;
    return (
      <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/50 px-2 py-1.5 text-emerald-900">
        <p className="font-sans text-[10px] font-semibold">✓ done</p>
        {ops != null ? <p className="mt-0.5 text-[9px]">Operations applied: {ops}</p> : null}
        {result ? (
          <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[9px] text-emerald-900/85">
            {result.slice(0, 1200)}{result.length > 1200 ? "…" : ""}
          </pre>
        ) : null}
      </div>
    );
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

  if (evt.type === "connected") {
    return <div className="text-black/50">● {evt.message}</div>;
  }

  if (isTerminal(evt)) return <div className="text-black/60">{evt.type}</div>;
  return <div className="text-black/40">{evt.type}</div>;
}

