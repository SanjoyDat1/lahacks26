"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Eye,
  FileEdit,
  FileSearch,
  Lightbulb,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Terminal,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LangGraphViz, type AgentEvent } from "@/components/langgraph-viz";

// ── Types ──────────────────────────────────────────────────────────────────────

type EventLog =
  | { id: number; kind: "agent_start"; agent: string; ts: number }
  | { id: number; kind: "agent_end"; agent: string; text: string; ts: number }
  | { id: number; kind: "tool_call"; agent: string; tool: string; input: Record<string, unknown>; run_id: string; ts: number }
  | { id: number; kind: "tool_result"; agent: string; tool: string; output: string; run_id: string; ts: number }
  | { id: number; kind: "thinking"; agent: string; content: string; ts: number }
  | { id: number; kind: "done"; result: string; ts: number }
  | { id: number; kind: "error"; message: string; ts: number };

const SAMPLE_PROMPTS = [
  "What are the core architectural decisions in this project?",
  "Explain the brain storage and retrieval system",
  "What integrations does this system support?",
  "What are the current open questions and constraints?",
];

// ── Main component ─────────────────────────────────────────────────────────────

export function AgentObservatory() {
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<"query" | "update">("query");
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [eventLog, setEventLog] = useState<EventLog[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [thinkingText, setThinkingText] = useState("");
  const [finalResult, setFinalResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<"idle" | "reader" | "writer" | "done" | "error">("idle");
  const [isAgentOnline, setIsAgentOnline] = useState<boolean | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"viz" | "trace">("viz");

  const logIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const textEndRef = useRef<HTMLDivElement>(null);

  function nextId() { return ++logIdRef.current; }

  // Health check with auto-retry while offline
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    async function check() {
      try {
        const r = await fetch("/api/agent/stream");
        const d = await r.json();
        const online = !d.offline;
        setIsAgentOnline(online);
        if (online) clearInterval(timer);
      } catch {
        setIsAgentOnline(false);
      }
    }
    check();
    timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventLog.length]);

  useEffect(() => {
    if (streamingText) textEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingText]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setAgentEvents([]);
    setEventLog([]);
    setStreamingText("");
    setThinkingText("");
    setFinalResult("");
    setError(null);
    setAgentStatus("idle");
    setExpandedLogs(new Set());
  }, []);

  const runAgent = useCallback(async () => {
    if (!prompt.trim() || isStreaming || isAgentOnline === false) return;
    reset();

    const ac = new AbortController();
    abortRef.current = ac;
    setIsStreaming(true);
    setAgentStatus("reader");

    let localText = "";

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), task }),
        signal: ac.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: AgentEvent;
          try { evt = JSON.parse(raw) as AgentEvent; }
          catch { continue; }

          setAgentEvents((prev) => [...prev, evt]);

          const id = nextId();
          const ts = Date.now();

          if (evt.type === "agent_start") {
            setAgentStatus(evt.agent as "reader" | "writer");
            setEventLog((prev) => [...prev, { id, kind: "agent_start", agent: evt.agent, ts }]);
          } else if (evt.type === "agent_end") {
            setEventLog((prev) => [...prev, { id, kind: "agent_end", agent: evt.agent, text: evt.text, ts }]);
          } else if (evt.type === "tool_call") {
            setEventLog((prev) => [...prev, { id, kind: "tool_call", agent: evt.agent, tool: evt.tool, input: evt.input, run_id: evt.run_id, ts }]);
          } else if (evt.type === "tool_result") {
            setEventLog((prev) => [...prev, { id, kind: "tool_result", agent: evt.agent, tool: evt.tool, output: evt.output, run_id: evt.run_id, ts }]);
          } else if (evt.type === "token") {
            localText += evt.content;
            setStreamingText(localText);
          } else if (evt.type === "thinking") {
            setThinkingText((p) => p + evt.content);
            setEventLog((prev) => {
              const last = prev.at(-1);
              if (last?.kind === "thinking" && last.agent === evt.agent)
                return [...prev.slice(0, -1), { ...last, content: last.content + evt.content }];
              return [...prev, { id, kind: "thinking", agent: evt.agent, content: evt.content, ts }];
            });
          } else if (evt.type === "done") {
            setFinalResult(evt.result);
            setAgentStatus("done");
            setIsStreaming(false);
            setEventLog((prev) => [...prev, { id, kind: "done", result: evt.result, ts }]);
          } else if (evt.type === "error") {
            setError(evt.message);
            setAgentStatus("error");
            setIsStreaming(false);
            setEventLog((prev) => [...prev, { id, kind: "error", message: evt.message, ts }]);
          } else if (evt.type === "stream_end") {
            setIsStreaming(false);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
        setAgentStatus("error");
      }
      setIsStreaming(false);
    }
  }, [prompt, task, isStreaming, isAgentOnline, reset]);

  const toggleLog = useCallback((id: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toolCalls = eventLog.filter((e) => e.kind === "tool_call");
  const hasActivity = eventLog.length > 0 || isStreaming;

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col overflow-hidden">

      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200/60 bg-white/70 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200/60">
            <Bot size={16} className="text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Agent Observatory</p>
            <p className="text-[11px] text-slate-400">Watch your AI agent read, think, and act in real time</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* API status pill */}
          <div className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all",
            isAgentOnline === true  ? "border-emerald-200/60 bg-emerald-50/80 text-emerald-700"
          : isAgentOnline === false ? "border-amber-200/60 bg-amber-50/80 text-amber-700"
          :                           "border-slate-200/60 bg-white/70 text-slate-500",
          )}>
            {isAgentOnline === null ? <Loader2 size={10} className="animate-spin" />
           : isAgentOnline         ? <Wifi size={10} />
           :                         <WifiOff size={10} />}
            {isAgentOnline === null ? "Checking…"
           : isAgentOnline         ? "Agent connected"
           :                         "Agent offline"}
          </div>

          {/* Stats chips */}
          {toolCalls.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50/80 px-2.5 py-1 text-[10px] font-medium text-blue-700">
              <Terminal size={9} />
              {toolCalls.length} tool call{toolCalls.length > 1 ? "s" : ""}
            </div>
          )}

          {/* Reset */}
          {hasActivity && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 hover:shadow-sm"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Offline banner ─────────────────────────────────────────────────────── */}
      {isAgentOnline === false && (
        <div className="flex items-start gap-3 border-b border-amber-200/60 bg-amber-50/80 px-6 py-3">
          <WifiOff size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-amber-800">Agent API is offline — start it to run queries</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <code className="rounded-lg border border-amber-200/60 bg-white/70 px-2.5 py-1 font-mono text-[10px] text-slate-700">
                cd agent &amp;&amp; uv run brain-api
              </code>
              <span className="text-[10px] text-amber-600">or</span>
              <code className="rounded-lg border border-amber-200/60 bg-white/70 px-2.5 py-1 font-mono text-[10px] text-slate-700">
                ./start.sh
              </code>
              <span className="ml-1 text-[10px] text-amber-500">Retrying every 5 s…</span>
            </div>
          </div>
          <Loader2 size={12} className="mt-0.5 animate-spin text-amber-400" />
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-0">

        {/* ── Left: Graph + trace (60%) ───────────────────────────────────────── */}
        <div className="flex w-[58%] min-w-0 flex-col border-r border-slate-200/60">

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-slate-200/60 bg-white/50 px-3 py-2 backdrop-blur-sm">
            {[
              { id: "viz"   as const, label: "LangGraph",   icon: <Cpu size={12} /> },
              { id: "trace" as const, label: "Event Trace", icon: <Terminal size={12} /> },
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-medium transition-all duration-150",
                  activeTab === id
                    ? "bg-white/90 text-slate-800 shadow-sm ring-1 ring-slate-200/70"
                    : "text-slate-500 hover:bg-white/60 hover:text-slate-700",
                )}
              >
                {icon} {label}
              </button>
            ))}

            {/* Breadcrumb: current agent */}
            {isStreaming && (
              <div className="ml-2 flex items-center gap-1.5">
                <span className="text-slate-300">·</span>
                <span className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                  agentStatus === "reader" ? "bg-blue-100 text-blue-700"
                : agentStatus === "writer" ? "bg-emerald-100 text-emerald-700"
                : "bg-violet-100 text-violet-700",
                )}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className={cn(
                      "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                      agentStatus === "reader" ? "bg-blue-400" : "bg-emerald-400",
                    )} />
                    <span className={cn(
                      "relative inline-flex h-1.5 w-1.5 rounded-full",
                      agentStatus === "reader" ? "bg-blue-600" : "bg-emerald-600",
                    )} />
                  </span>
                  {agentStatus === "reader" ? "Reader running" : "Writer running"}
                </span>
              </div>
            )}
          </div>

          {/* Graph / Trace content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === "viz" ? (
              <div className="h-full p-4">
                <LangGraphViz events={agentEvents} isStreaming={isStreaming} task={task} />
              </div>
            ) : (
              <div className="flex h-full flex-col overflow-hidden bg-slate-50/40">
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-px font-mono text-[11px]">
                  {eventLog.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="text-center text-slate-400">
                        <Terminal size={28} className="mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-medium">No events yet</p>
                        <p className="mt-1 text-xs">Run a query to see the full event trace</p>
                      </div>
                    </div>
                  ) : (
                    eventLog.map((entry) => (
                      <TraceEntry
                        key={entry.id}
                        entry={entry}
                        expanded={expandedLogs.has(entry.id)}
                        onToggle={() => toggleLog(entry.id)}
                      />
                    ))
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Reasoning + Input (42%) ─────────────────────────────────── */}
        <div className="flex w-[42%] min-w-0 flex-col bg-white/30">

          {/* Reasoning stream */}
          <div className="flex min-h-0 flex-1 flex-col">

            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-slate-200/60 bg-white/60 px-4 py-2.5 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Brain size={13} className="text-violet-500" />
                <span className="text-[11px] font-semibold text-slate-700">Agent Response</span>
              </div>
              <StatusBadge status={agentStatus} isStreaming={isStreaming} />
            </div>

            {/* Thinking section (if any) */}
            {thinkingText && (
              <div className="border-b border-violet-100/60 bg-violet-50/40 px-4 py-3">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Lightbulb size={10} className="text-violet-500" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-violet-500">Internal reasoning</span>
                </div>
                <p className="text-[12px] leading-[1.6] text-violet-600/80 italic">{thinkingText}</p>
              </div>
            )}

            {/* Response text */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {streamingText || finalResult ? (
                <p className="text-[13px] leading-7 text-slate-700 whitespace-pre-wrap">
                  {streamingText || finalResult}
                  {isStreaming && streamingText && (
                    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-violet-500 align-middle" />
                  )}
                </p>
              ) : agentStatus === "error" && error ? (
                <ErrorState message={error} />
              ) : agentStatus === "idle" ? (
                <EmptyState />
              ) : (
                <div className="flex items-center gap-2 text-slate-400 text-xs pt-2">
                  <Loader2 size={13} className="animate-spin text-violet-400" />
                  <span>Agent working…</span>
                </div>
              )}
              <div ref={textEndRef} />
            </div>
          </div>

          {/* Tool call summary strip */}
          {toolCalls.length > 0 && (
            <div className="border-t border-slate-200/50 bg-white/40">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200/40">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                  Tool calls · {toolCalls.length}
                </span>
              </div>
              <div className="max-h-[130px] overflow-y-auto divide-y divide-slate-100/70">
                {toolCalls.map((e) => {
                  if (e.kind !== "tool_call") return null;
                  const result = eventLog.find((r) => r.kind === "tool_result" && r.run_id === e.run_id);
                  return (
                    <ToolCallRow
                      key={e.id}
                      tool={e.tool}
                      agent={e.agent}
                      input={e.input}
                      output={result?.kind === "tool_result" ? result.output : undefined}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-slate-200/60 bg-white/70 px-4 py-4 backdrop-blur-xl">

            {/* Mode toggle */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-400">Mode:</span>
              {([ ["query", "Query", <Eye key="q" size={10}/>], ["update", "Update brain", <FileEdit key="u" size={10}/>] ] as const).map(([id, label, icon]) => (
                <button
                  key={id}
                  onClick={() => setTask(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-all",
                    task === id
                      ? "border-violet-300/60 bg-violet-50/80 text-violet-700"
                      : "border-slate-200/60 bg-white/70 text-slate-500 hover:border-slate-300 hover:text-slate-700",
                  )}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* Sample prompts (shown when idle) */}
            {!hasActivity && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {SAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrompt(p)}
                    className="rounded-full border border-slate-200/60 bg-white/70 px-2.5 py-1 text-[10px] text-slate-500 transition hover:border-violet-300/60 hover:bg-violet-50/80 hover:text-violet-700 text-left"
                  >
                    {p.length > 42 ? p.slice(0, 42) + "…" : p}
                  </button>
                ))}
              </div>
            )}

            {/* Textarea + send */}
            <div className="flex items-end gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAgent(); }
                }}
                placeholder={
                  isAgentOnline === false
                    ? "Start the agent API first…"
                    : "Ask anything about the brain, or give an update task…"
                }
                rows={2}
                disabled={isStreaming || isAgentOnline === false}
                className="flex-1 resize-none rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-[13px] text-slate-800 placeholder-slate-400 outline-none transition-all backdrop-blur-sm focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/15 disabled:opacity-50"
              />
              <button
                onClick={runAgent}
                disabled={isStreaming || !prompt.trim() || isAgentOnline === false}
                className={cn(
                  "flex h-[52px] w-11 flex-shrink-0 items-center justify-center rounded-xl transition-all",
                  isStreaming
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : prompt.trim() && isAgentOnline !== false
                    ? "bg-violet-600 text-white shadow-md shadow-violet-300/40 hover:bg-violet-700"
                    : "bg-slate-100 text-slate-300 cursor-not-allowed",
                )}
              >
                {isStreaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
            <p className="mt-1.5 text-[9px] text-slate-400">↵ Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status, isStreaming }: { status: string; isStreaming: boolean }) {
  if (isStreaming) {
    const isBlue = status === "reader";
    return (
      <div className={cn(
        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        isBlue ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700",
      )}>
        <span className={cn(
          "relative flex h-1.5 w-1.5 rounded-full",
          isBlue ? "bg-blue-500" : "bg-emerald-500",
        )}>
          <span className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            isBlue ? "bg-blue-400" : "bg-emerald-400",
          )} />
        </span>
        {status === "reader" ? "Reader" : "Writer"} active
      </div>
    );
  }
  if (status === "done") return (
    <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
      <CheckCircle2 size={10} /> Complete
    </div>
  );
  if (status === "error") return (
    <div className="flex items-center gap-1 text-[10px] font-semibold text-red-500">
      <AlertCircle size={10} /> Error
    </div>
  );
  return null;
}

function ToolCallRow({
  tool, agent, input, output,
}: {
  tool: string; agent: string;
  input: Record<string, unknown>; output?: string;
}) {
  const isRead = !["upsert_working_file","replace_working_file","propose_update","record_audit"].includes(tool);
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <div className={cn(
        "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md",
        output ? "bg-emerald-100" : "bg-amber-100",
      )}>
        {output
          ? <FileSearch size={9} className="text-emerald-600" />
          : <Loader2 size={9} className="animate-spin text-amber-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] font-semibold text-slate-700">{tool}</span>
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase",
            agent === "reader" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600",
          )}>
            {agent}
          </span>
          {!output && <span className="text-[9px] text-amber-500">running…</span>}
        </div>
        {Object.keys(input).length > 0 && (
          <p className="mt-0.5 truncate text-[10px] text-slate-400">
            {Object.entries(input).map(([k, v]) => `${k}: ${String(v).slice(0, 35)}`).join(" · ")}
          </p>
        )}
        {output && (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-emerald-600">
            ↳ {output.slice(0, 90)}
          </p>
        )}
      </div>
    </div>
  );
}

function TraceEntry({
  entry, expanded, onToggle,
}: {
  entry: EventLog; expanded: boolean; onToggle: () => void;
}) {
  const ts = new Date(entry.ts).toISOString().slice(11, 23);

  if (entry.kind === "agent_start") {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-1">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        <div className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
          entry.agent === "reader" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700",
        )}>
          ▶ {entry.agent.toUpperCase()} START
        </div>
      </div>
    );
  }

  if (entry.kind === "agent_end") {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-1">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        <div className={cn(
          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
          entry.agent === "reader" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600",
        )}>
          ✓ {entry.agent.toUpperCase()} END
        </div>
      </div>
    );
  }

  if (entry.kind === "tool_call") {
    return (
      <div>
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/60"
        >
          <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
          {expanded ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronRight size={10} className="text-slate-400" />}
          <div className="flex items-center gap-1 rounded-md border border-amber-200/60 bg-amber-50/80 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-700">
            ⚙ {entry.tool}
          </div>
          <span className="text-[9px] text-slate-400">call</span>
        </button>
        {expanded && (
          <div className="mx-[100px] mb-1 mt-0.5 rounded-xl border border-slate-200/60 bg-white/70 p-3">
            <p className="mb-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">Input</p>
            <pre className="whitespace-pre-wrap break-all text-[10px] text-slate-600">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === "tool_result") {
    return (
      <div>
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/60"
        >
          <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
          {expanded ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronRight size={10} className="text-slate-400" />}
          <div className="flex items-center gap-1 rounded-md border border-emerald-200/60 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-700">
            ✓ {entry.tool}
          </div>
          <span className="text-[9px] text-slate-400">{entry.output.length} chars</span>
        </button>
        {expanded && (
          <div className="mx-[100px] mb-1 mt-0.5 rounded-xl border border-slate-200/60 bg-white/70 p-3">
            <p className="mb-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">Output</p>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-[10px] text-slate-600">
              {entry.output}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (entry.kind === "thinking") {
    return (
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/60"
      >
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        {expanded ? <ChevronDown size={10} className="mt-0.5 text-slate-400" /> : <ChevronRight size={10} className="mt-0.5 text-slate-400" />}
        <div className="flex items-center gap-1 rounded-md border border-violet-200/60 bg-violet-50/80 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
          💭 thinking
        </div>
        {!expanded && (
          <span className="truncate text-[10px] italic text-slate-500">{entry.content.slice(0, 55)}</span>
        )}
        {expanded && (
          <p className="mt-1 text-[11px] italic leading-5 text-violet-700/70 whitespace-pre-wrap">{entry.content}</p>
        )}
      </button>
    );
  }

  if (entry.kind === "done") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200/50 bg-emerald-50/70 px-2 py-1.5">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        <Zap size={10} className="text-emerald-500" />
        <span className="text-[10px] font-bold text-emerald-700">DONE</span>
        <span className="truncate text-[9px] text-emerald-600">{entry.result.slice(0, 70)}</span>
      </div>
    );
  }

  if (entry.kind === "error") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200/50 bg-red-50/70 px-2 py-1.5">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        <AlertCircle size={10} className="text-red-500" />
        <span className="text-[10px] font-semibold text-red-700">ERROR</span>
        <span className="truncate text-[10px] text-red-600">{entry.message}</span>
      </div>
    );
  }

  return null;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-5 px-2 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100/80 ring-1 ring-violet-200/60">
        <Sparkles size={22} className="text-violet-500" />
      </div>
      <div className="max-w-[280px]">
        <p className="text-sm font-semibold text-slate-700">Ready to observe</p>
        <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
          Type a question below and watch the AI agent read your brain files, call tools, and reason step-by-step in real time.
        </p>
      </div>
      <div className="w-full rounded-2xl border border-slate-200/60 bg-white/60 p-4 text-left">
        <p className="mb-2.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">What you&apos;ll see</p>
        {[
          { icon: <Cpu size={9} />, text: "Animated LangGraph — nodes light up as the agent moves" },
          { icon: <Terminal size={9} />, text: "Every tool call with exact inputs and outputs" },
          { icon: <Lightbulb size={9} />, text: "Internal reasoning traces from the model" },
          { icon: <Brain size={9} />, text: "Which brain files are read or written, and why" },
        ].map(({ icon, text }, i) => (
          <div key={i} className="flex items-start gap-2.5 py-1">
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-500 mt-0.5">
              {icon}
            </span>
            <p className="text-[11px] leading-4 text-slate-500">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  const needsStart  = message.includes("Cannot reach");
  const needsApiKey = message.toLowerCase().includes("api_key") || message.toLowerCase().includes("api key");

  return (
    <div className="rounded-2xl border border-red-200/60 bg-red-50/80 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle size={13} className="text-red-500" />
        <p className="text-sm font-semibold text-red-700">Agent error</p>
      </div>
      <p className="text-[12px] text-red-600">{message}</p>

      {needsStart && (
        <div className="mt-3 rounded-xl border border-red-200/50 bg-white/70 p-3 space-y-1">
          <p className="text-[10px] font-semibold text-slate-600">Start the Python agent API:</p>
          <code className="block font-mono text-[10px] text-emerald-700">cd agent &amp;&amp; uv run brain-api</code>
          <code className="block font-mono text-[10px] text-emerald-700">./start.sh &nbsp;&nbsp;# starts everything together</code>
        </div>
      )}
      {needsApiKey && (
        <div className="mt-3 rounded-xl border border-red-200/50 bg-white/70 p-3 space-y-1">
          <p className="text-[10px] font-semibold text-slate-600">Add your API key to <code className="font-mono">.env</code>:</p>
          <code className="block font-mono text-[10px] text-violet-700">OPENAI_API_KEY=sk-…</code>
        </div>
      )}
    </div>
  );
}
