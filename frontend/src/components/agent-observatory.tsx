"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LangGraphViz, type AgentEvent } from "@/components/langgraph-viz";

// ── Types ──────────────────────────────────────────────────────────────────────

type ToolEntry = {
  run_id: string;
  tool: string;
  agent: string;
  input: Record<string, unknown>;
  output?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  streaming: boolean;
  thinking: string;
  tools: ToolEntry[];
  status: "pending" | "streaming" | "done" | "error";
  error?: string;
};

type EventLog =
  | { id: number; kind: "agent_start"; agent: string; ts: number }
  | { id: number; kind: "agent_end"; agent: string; text: string; ts: number }
  | { id: number; kind: "tool_call"; agent: string; tool: string; input: Record<string, unknown>; run_id: string; ts: number }
  | { id: number; kind: "tool_result"; agent: string; tool: string; output: string; run_id: string; ts: number }
  | { id: number; kind: "thinking"; agent: string; content: string; ts: number }
  | { id: number; kind: "done"; result: string; ts: number }
  | { id: number; kind: "error"; message: string; ts: number };

const SAMPLE_PROMPTS = [
  "What are the core architectural decisions?",
  "Explain how Brian stores and retrieves knowledge",
  "What integrations does this system support?",
  "What are the current open questions?",
];

// ── Main component ─────────────────────────────────────────────────────────────

export function AgentObservatory() {
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<"query" | "update">("query");
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [eventLog, setEventLog] = useState<EventLog[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<"idle" | "reader" | "writer" | "done" | "error">("idle");
  const [isAgentOnline, setIsAgentOnline] = useState<boolean | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"viz" | "trace">("viz");

  const logIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeMsgIdRef = useRef<string | null>(null);

  function nextId() { return ++logIdRef.current; }

  useEffect(() => {
    async function check() {
      try {
        const r = await fetch("/api/agent/stream");
        const d = await r.json();
        setIsAgentOnline(!d.offline);
      } catch {
        setIsAgentOnline(false);
      }
    }
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLog.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setAgentEvents([]);
    setEventLog([]);
    setMessages([]);
    setAgentStatus("idle");
    setExpandedLogs(new Set());
    activeMsgIdRef.current = null;
  }, []);

  const runAgent = useCallback(async () => {
    if (!prompt.trim() || isStreaming || isAgentOnline === false) return;

    const userPrompt = prompt.trim();
    setPrompt("");

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userPrompt,
      ts: Date.now(),
      streaming: false,
      thinking: "",
      tools: [],
      status: "done",
    };

    const agentMsgId = `agent-${Date.now()}`;
    activeMsgIdRef.current = agentMsgId;
    const agentMsg: ChatMessage = {
      id: agentMsgId,
      role: "assistant",
      content: "",
      ts: Date.now(),
      streaming: true,
      thinking: "",
      tools: [],
      status: "streaming",
    };

    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setAgentEvents([]);
    setEventLog([]);
    setExpandedLogs(new Set());

    const ac = new AbortController();
    abortRef.current = ac;
    setIsStreaming(true);
    setAgentStatus("reader");

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt, task }),
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
          const mid = agentMsgId;

          if (evt.type === "agent_start") {
            setAgentStatus(evt.agent as "reader" | "writer");
            setEventLog((prev) => [...prev, { id, kind: "agent_start", agent: evt.agent, ts }]);
          } else if (evt.type === "agent_end") {
            setEventLog((prev) => [...prev, { id, kind: "agent_end", agent: evt.agent, text: evt.text, ts }]);
          } else if (evt.type === "tool_call") {
            setEventLog((prev) => [...prev, { id, kind: "tool_call", agent: evt.agent, tool: evt.tool, input: evt.input, run_id: evt.run_id, ts }]);
            setMessages((prev) => prev.map((m) =>
              m.id === mid
                ? { ...m, tools: [...m.tools, { run_id: evt.run_id, tool: evt.tool, agent: evt.agent, input: evt.input }] }
                : m,
            ));
          } else if (evt.type === "tool_result") {
            setEventLog((prev) => [...prev, { id, kind: "tool_result", agent: evt.agent, tool: evt.tool, output: evt.output, run_id: evt.run_id, ts }]);
            setMessages((prev) => prev.map((m) =>
              m.id === mid
                ? { ...m, tools: m.tools.map((t) => t.run_id === evt.run_id ? { ...t, output: evt.output } : t) }
                : m,
            ));
          } else if (evt.type === "token") {
            setMessages((prev) => prev.map((m) =>
              m.id === mid ? { ...m, content: m.content + evt.content } : m,
            ));
          } else if (evt.type === "thinking") {
            setMessages((prev) => prev.map((m) =>
              m.id === mid ? { ...m, thinking: m.thinking + evt.content } : m,
            ));
            setEventLog((prev) => {
              const last = prev.at(-1);
              if (last?.kind === "thinking" && last.agent === evt.agent)
                return [...prev.slice(0, -1), { ...last, content: last.content + evt.content }];
              return [...prev, { id, kind: "thinking", agent: evt.agent, content: evt.content, ts }];
            });
          } else if (evt.type === "done") {
            setMessages((prev) => prev.map((m) =>
              m.id === mid
                ? { ...m, content: m.content || evt.result, streaming: false, status: "done" }
                : m,
            ));
            setAgentStatus("done");
            setIsStreaming(false);
            setEventLog((prev) => [...prev, { id, kind: "done", result: evt.result, ts }]);
          } else if (evt.type === "error") {
            setMessages((prev) => prev.map((m) =>
              m.id === mid ? { ...m, streaming: false, status: "error", error: evt.message } : m,
            ));
            setAgentStatus("error");
            setIsStreaming(false);
            setEventLog((prev) => [...prev, { id, kind: "error", message: evt.message, ts }]);
          } else if (evt.type === "stream_end") {
            setMessages((prev) => prev.map((m) =>
              m.id === mid && m.status === "streaming" ? { ...m, streaming: false, status: "done" } : m,
            ));
            setIsStreaming(false);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        const mid = agentMsgId;
        setMessages((prev) => prev.map((m) =>
          m.id === mid ? { ...m, streaming: false, status: "error", error: err.message } : m,
        ));
        setAgentStatus("error");
      }
      setIsStreaming(false);
    }
  }, [prompt, task, isStreaming, isAgentOnline]);

  const toggleLog = useCallback((id: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toolCalls = eventLog.filter((e) => e.kind === "tool_call");

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col overflow-hidden">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
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
          {toolCalls.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50/80 px-2.5 py-1 text-[10px] font-medium text-blue-700">
              <Terminal size={9} />
              {toolCalls.length} tool call{toolCalls.length > 1 ? "s" : ""}
            </div>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-white hover:text-red-500"
            >
              <Trash2 size={11} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Offline banner ──────────────────────────────────────────────────── */}
      {isAgentOnline === false && (
        <div className="flex items-start gap-3 border-b border-amber-200/60 bg-amber-50/80 px-6 py-3">
          <WifiOff size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-amber-800">Agent API is offline — start it to run queries</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <code className="rounded-lg border border-amber-200/60 bg-white/70 px-2.5 py-1 font-mono text-[10px] text-slate-700">
                cd agent &amp;&amp; uv run brain-api
              </code>
            </div>
          </div>
          <Loader2 size={12} className="mt-0.5 animate-spin text-amber-400" />
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-0">

        {/* ── Left: Graph + trace (58%) ─────────────────────────────────────── */}
        <div className="flex w-[58%] min-w-0 flex-col border-r border-slate-200/60">
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
            {isStreaming && (
              <div className="ml-2 flex items-center gap-1.5">
                <span className="text-slate-300">·</span>
                <span className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                  agentStatus === "reader" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700",
                )}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", agentStatus === "reader" ? "bg-blue-400" : "bg-emerald-400")} />
                    <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", agentStatus === "reader" ? "bg-blue-600" : "bg-emerald-600")} />
                  </span>
                  {agentStatus === "reader" ? "Reader running" : "Writer running"}
                </span>
              </div>
            )}
          </div>

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

        {/* ── Right: Chat thread (42%) ──────────────────────────────────────── */}
        <div className="flex w-[42%] min-w-0 flex-col bg-white/30">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200/60 bg-white/60 px-4 py-2.5 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Brain size={13} className="text-violet-500" />
              <span className="text-[11px] font-semibold text-slate-700">Agent Chat</span>
              {messages.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                  {Math.ceil(messages.length / 2)} exchange{Math.ceil(messages.length / 2) !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <StatusBadge status={agentStatus} isStreaming={isStreaming} />
          </div>

          {/* Message thread */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-slate-200/60 bg-white/80 px-4 py-4 backdrop-blur-xl">

            {/* Mode toggle */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-400">Mode:</span>
              {([ ["query", "Query", <Eye key="q" size={10}/>], ["update", "Update Brian", <FileEdit key="u" size={10}/>] ] as const).map(([id, label, icon]) => (
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

            {/* Sample prompts when no messages */}
            {messages.length === 0 && (
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
                    : messages.length === 0
                      ? "Ask anything about Brian…"
                      : "Ask a follow-up question…"
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

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const isUser = message.role === "user";
  const time = new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  function toggleTool(id: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%]">
          <div className="flex items-center justify-end gap-2 mb-1 px-1">
            <span className="text-[9px] text-slate-400">{time}</span>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">You</span>
          </div>
          <div className="rounded-2xl rounded-br-md bg-violet-600 px-4 py-3 text-[13px] leading-6 text-white shadow-sm">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // Assistant bubble
  return (
    <div className="flex justify-start">
      <div className="max-w-[96%] w-full">
        <div className="flex items-center gap-2 mb-1.5 px-1">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-100">
            <Bot size={10} className="text-violet-600" />
          </div>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Agent</span>
          <span className="text-[9px] text-slate-400">{time}</span>
          {message.status === "streaming" && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Streaming
            </span>
          )}
          {message.status === "done" && message.content && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-600">
              <CheckCircle2 size={9} /> Done
            </span>
          )}
        </div>

        <div className="rounded-2xl rounded-tl-md border border-slate-200/60 bg-white/85 shadow-sm backdrop-blur-sm overflow-hidden">

          {/* Thinking strip */}
          {message.thinking && (
            <button
              onClick={() => setThinkingOpen((v) => !v)}
              className="flex w-full items-start gap-2 border-b border-violet-100/60 bg-violet-50/50 px-4 py-2.5 text-left transition hover:bg-violet-50/80"
            >
              <Lightbulb size={11} className="mt-0.5 flex-shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-violet-600">Internal reasoning</span>
                  {thinkingOpen ? <ChevronDown size={9} className="text-violet-400" /> : <ChevronRight size={9} className="text-violet-400" />}
                </div>
                {!thinkingOpen && (
                  <p className="mt-0.5 truncate text-[10px] italic text-violet-500/80">
                    {message.thinking.slice(0, 80)}…
                  </p>
                )}
              </div>
            </button>
          )}
          {message.thinking && thinkingOpen && (
            <div className="border-b border-violet-100/60 bg-violet-50/30 px-4 py-3">
              <p className="text-[11px] italic leading-[1.65] text-violet-600/80 whitespace-pre-wrap">
                {message.thinking}
              </p>
            </div>
          )}

          {/* Tool calls */}
          {message.tools.length > 0 && (
            <div className="border-b border-slate-100/60 divide-y divide-slate-100/60">
              {message.tools.map((tool) => {
                const isExpanded = expandedTools.has(tool.run_id);
                return (
                  <div key={tool.run_id}>
                    <button
                      onClick={() => toggleTool(tool.run_id)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left transition hover:bg-slate-50/80"
                    >
                      <div className={cn(
                        "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md",
                        tool.output ? "bg-emerald-100" : "bg-amber-100",
                      )}>
                        {tool.output
                          ? <FileSearch size={9} className="text-emerald-600" />
                          : <Loader2 size={9} className="animate-spin text-amber-500" />}
                      </div>
                      <span className="font-mono text-[10px] font-semibold text-slate-700">{tool.tool}</span>
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase",
                        tool.agent === "reader" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600",
                      )}>
                        {tool.agent}
                      </span>
                      {Object.keys(tool.input).length > 0 && (
                        <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                          {Object.entries(tool.input).map(([k, v]) => `${k}: ${String(v).slice(0, 28)}`).join(" · ")}
                        </span>
                      )}
                      {tool.output && <span className="flex-shrink-0 text-[9px] text-emerald-600">{tool.output.length} chars</span>}
                      <Wrench size={9} className="flex-shrink-0 text-slate-300" />
                    </button>
                    {isExpanded && (
                      <div className="mx-3 mb-2 rounded-xl border border-slate-200/60 bg-slate-50/70 p-3 space-y-2">
                        {Object.keys(tool.input).length > 0 && (
                          <div>
                            <p className="mb-1 text-[8px] font-bold uppercase tracking-widest text-slate-400">Input</p>
                            <pre className="whitespace-pre-wrap break-all text-[10px] text-slate-600 leading-4">
                              {JSON.stringify(tool.input, null, 2)}
                            </pre>
                          </div>
                        )}
                        {tool.output && (
                          <div>
                            <p className="mb-1 text-[8px] font-bold uppercase tracking-widest text-slate-400">Output</p>
                            <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-all text-[10px] text-emerald-700 leading-4">
                              {tool.output}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Response content */}
          <div className="px-4 py-3.5">
            {message.status === "error" && message.error ? (
              <div className="flex items-start gap-2 rounded-xl border border-red-200/60 bg-red-50/80 p-3">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-red-500" />
                <div>
                  <p className="text-[11px] font-semibold text-red-700">Agent error</p>
                  <p className="mt-0.5 text-[11px] text-red-600">{message.error}</p>
                </div>
              </div>
            ) : message.content ? (
              <div className="prose prose-sm prose-slate max-w-none text-[13px] leading-6
                [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0
                [&>ul]:my-2 [&>ol]:my-2 [&>li]:my-0.5
                [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-xs
                [&_strong]:font-semibold [&_strong]:text-slate-800
                [&_em]:italic [&_em]:text-slate-600
                [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-violet-700
                [&_pre]:rounded-xl [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:text-emerald-300 [&_pre_code]:px-0 [&_pre_code]:py-0
                [&_blockquote]:border-l-2 [&_blockquote]:border-violet-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-500
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
                {message.streaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-violet-500 align-middle" />
                )}
              </div>
            ) : message.status === "streaming" ? (
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 size={13} className="animate-spin text-violet-400" />
                <span className="text-[12px]">Thinking…</span>
              </div>
            ) : null}
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
        <span className="relative flex h-1.5 w-1.5 rounded-full">
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", isBlue ? "bg-blue-400" : "bg-emerald-400")} />
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", isBlue ? "bg-blue-500" : "bg-emerald-500")} />
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

function TraceEntry({ entry, expanded, onToggle }: { entry: EventLog; expanded: boolean; onToggle: () => void; }) {
  const ts = new Date(entry.ts).toISOString().slice(11, 23);

  if (entry.kind === "agent_start") {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-1">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        <div className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", entry.agent === "reader" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700")}>
          ▶ {entry.agent.toUpperCase()} START
        </div>
      </div>
    );
  }
  if (entry.kind === "agent_end") {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-1">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        <div className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", entry.agent === "reader" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600")}>
          ✓ {entry.agent.toUpperCase()} END
        </div>
      </div>
    );
  }
  if (entry.kind === "tool_call") {
    return (
      <div>
        <button onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/60">
          <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
          {expanded ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronRight size={10} className="text-slate-400" />}
          <div className="flex items-center gap-1 rounded-md border border-amber-200/60 bg-amber-50/80 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-700">⚙ {entry.tool}</div>
          <span className="text-[9px] text-slate-400">call</span>
        </button>
        {expanded && (
          <div className="mx-[100px] mb-1 mt-0.5 rounded-xl border border-slate-200/60 bg-white/70 p-3">
            <p className="mb-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">Input</p>
            <pre className="whitespace-pre-wrap break-all text-[10px] text-slate-600">{JSON.stringify(entry.input, null, 2)}</pre>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === "tool_result") {
    return (
      <div>
        <button onClick={onToggle} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/60">
          <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
          {expanded ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronRight size={10} className="text-slate-400" />}
          <div className="flex items-center gap-1 rounded-md border border-emerald-200/60 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-700">✓ {entry.tool}</div>
          <span className="text-[9px] text-slate-400">{entry.output.length} chars</span>
        </button>
        {expanded && (
          <div className="mx-[100px] mb-1 mt-0.5 rounded-xl border border-slate-200/60 bg-white/70 p-3">
            <p className="mb-1.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">Output</p>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-[10px] text-slate-600">{entry.output}</pre>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === "thinking") {
    return (
      <button onClick={onToggle} className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/60">
        <span className="w-[88px] flex-shrink-0 text-[9px] tabular-nums text-slate-400">{ts}</span>
        {expanded ? <ChevronDown size={10} className="mt-0.5 text-slate-400" /> : <ChevronRight size={10} className="mt-0.5 text-slate-400" />}
        <div className="flex items-center gap-1 rounded-md border border-violet-200/60 bg-violet-50/80 px-2 py-0.5 text-[10px] font-semibold text-violet-700">💭 thinking</div>
        {!expanded && <span className="truncate text-[10px] italic text-slate-500">{entry.content.slice(0, 55)}</span>}
        {expanded && <p className="mt-1 text-[11px] italic leading-5 text-violet-700/70 whitespace-pre-wrap">{entry.content}</p>}
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
    <div className="flex flex-col items-center gap-5 px-2 py-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100/80 ring-1 ring-violet-200/60">
        <Sparkles size={22} className="text-violet-500" />
      </div>
      <div className="max-w-[280px]">
        <p className="text-sm font-semibold text-slate-700">Ask the agent anything</p>
        <p className="mt-1.5 text-[12px] leading-5 text-slate-500">
          Ask questions about your Brian files and watch the agent read, think, and answer — step by step.
        </p>
      </div>
      <div className="w-full rounded-2xl border border-slate-200/60 bg-white/60 p-4 text-left">
        <p className="mb-2.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">What you&apos;ll see</p>
        {[
          { icon: <Cpu size={9} />, text: "LangGraph nodes lighting up as the agent moves through steps" },
          { icon: <Wrench size={9} />, text: "Tool calls with exact inputs and outputs, inline in each reply" },
          { icon: <Lightbulb size={9} />, text: "Internal reasoning shown as a collapsible thinking trace" },
          { icon: <Brain size={9} />, text: "Full conversation history preserved across questions" },
        ].map(({ icon, text }, i) => (
          <div key={i} className="flex items-start gap-2.5 py-1">
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-500 mt-0.5">{icon}</span>
            <p className="text-[11px] leading-4 text-slate-500">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
