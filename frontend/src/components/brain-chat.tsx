"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bot, CheckCircle, FileText, Pencil, Send, User, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { BrianFile } from "@/lib/brian/reader";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  streaming?: boolean;
};

type EditState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "preview"; file: string; original: string; newContent: string; summary: string }
  | { status: "applying" }
  | { status: "applied"; file: string; summary: string }
  | { status: "error"; message: string };

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi, I'm Brian. Ask me anything about this project — architecture, decisions, goals, integrations, or constraints.",
  sources: [],
};

type Mode = "chat" | "edit";

type BrainChatProps = {
  contextHint?: string;
  files?: BrianFile[];
  onOpenSource?: (file: BrianFile) => void;
};

export function BrainChat({ contextHint, files = [], onOpenSource }: BrainChatProps) {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Edit brain state
  const [editInstruction, setEditInstruction] = useState("");
  const [editState, setEditState] = useState<EditState>({ status: "idle" });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Chat logic ──────────────────────────────────────────────────────────────

  function send() {
    const text = input.trim();
    if (!text || isPending) return;
    setInput("");

    const contextualText = contextHint ? `${contextHint}\n\n${text}` : text;
    const userMsg: Message = { id: stableKey(), role: "user", content: text };
    const assistantId = stableKey();
    const placeholder: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages((prev) => [...prev, userMsg, placeholder]);

    const history = messages
      .filter((m) => !m.streaming)
      .map(({ role, content }) => ({ role, content }));
    history.push({ role: "user", content: contextualText });

    startTransition(async () => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Request failed. Please try again.", streaming: false }
              : m,
          ),
        );
        return;
      }

      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let sources: string[] = [];
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const raw = line.slice(5).trim();
              if (raw === "[DONE]") break;
              try {
                const parsed = JSON.parse(raw) as { sources?: string[]; delta?: string };
                if (parsed.sources) sources = parsed.sources;
                if (parsed.delta) accumulated += parsed.delta;
              } catch { /* ignore */ }
            }
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated, sources, streaming: true } : m,
            ),
          );
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: accumulated, sources, streaming: false } : m,
          ),
        );
      } else {
        const data = (await response.json()) as { content: string; sources: string[] };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: data.content, sources: data.sources, streaming: false }
              : m,
          ),
        );
      }
    });
  }

  // ── Edit logic ──────────────────────────────────────────────────────────────

  async function generateEdit() {
    const text = editInstruction.trim();
    if (!text) return;
    const instruction = contextHint ? `${contextHint}\n\n${text}` : text;
    setEditState({ status: "loading" });
    try {
      const res = await fetch("/api/brian/ai-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await res.json()) as {
        file?: string; original?: string; newContent?: string; summary?: string; error?: string;
      };
      if (!res.ok || data.error) {
        setEditState({ status: "error", message: data.error ?? "Unknown error" });
        return;
      }
      setEditState({
        status: "preview",
        file: data.file!,
        original: data.original!,
        newContent: data.newContent!,
        summary: data.summary!,
      });
    } catch (err) {
      setEditState({ status: "error", message: String(err) });
    }
  }

  async function applyEdit() {
    if (editState.status !== "preview") return;
    const { file, summary } = editState;
    setEditState({ status: "applying" });
    try {
      const instruction = contextHint ? `${contextHint}\n\n${editInstruction.trim()}` : editInstruction.trim();
      const res = await fetch("/api/brian/ai-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction, apply: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) {
        setEditState({ status: "error", message: data.error ?? "Apply failed" });
        return;
      }
      setEditState({ status: "applied", file, summary });
      setEditInstruction("");
    } catch (err) {
      setEditState({ status: "error", message: String(err) });
    }
  }

  function resetEdit() {
    setEditState({ status: "idle" });
    setEditInstruction("");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Mode toggle */}
      <div className="flex border-b border-slate-200/60 bg-white/40 p-2 gap-1.5 backdrop-blur-sm">
        <ModeTab active={mode === "chat"} onClick={() => setMode("chat")} icon={<Bot size={12} />}>
          Ask
        </ModeTab>
        <ModeTab active={mode === "edit"} onClick={() => setMode("edit")} icon={<Pencil size={12} />}>
          Edit in Brian
        </ModeTab>
      </div>

      {/* ── Chat panel ── */}
      {mode === "chat" && (
        <>
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex gap-2.5", msg.role === "user" && "flex-row-reverse")}>
                <Avatar role={msg.role} />
                <div className="max-w-[88%] space-y-1.5">
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm leading-6",
                      msg.role === "assistant"
                        ? "border border-slate-200/70 bg-white/80 text-slate-700 shadow-sm"
                        : "bg-violet-600 text-white shadow-md shadow-violet-300/30",
                    )}
                  >
                    {msg.streaming && !msg.content ? (
                      <Dots />
                    ) : (
                      <div className="prose prose-sm prose-slate max-w-none leading-6 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                    {msg.streaming && msg.content && (
                      <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-violet-500 align-middle" />
                    )}
                  </div>
                  {msg.sources && msg.sources.length > 0 && !msg.streaming && (
                    <div className="flex flex-wrap gap-1">
                      {msg.sources.map((s) => {
                        const file = files.find((f) => f.path === s || f.frontmatter.title === s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => file && onOpenSource?.(file)}
                            disabled={!file || !onOpenSource}
                            title={file?.path ?? s}
                            className="flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 px-2.5 py-0.5 text-[10px] text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-700 disabled:cursor-default disabled:hover:bg-white/70 disabled:hover:text-slate-500"
                          >
                            <FileText size={9} />
                            {file?.frontmatter.title ?? s}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200/60 bg-white/40 p-3 backdrop-blur-sm">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
                  e.preventDefault();
                  send();
                }}
                placeholder={contextHint ? "Ask about the selected brain file…" : "Ask about architecture, decisions, goals…"}
                className="flex-1 resize-none rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/15 transition-all backdrop-blur-sm"
                rows={2}
              />
              <button
                onClick={send}
                disabled={!input.trim() || isPending}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-md shadow-violet-300/30 transition-all hover:bg-violet-700 disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              Enter or ⌘/Ctrl+Enter to send · Shift+Enter for newline
            </p>
          </div>
        </>
      )}

      {/* ── Brian editor panel ── */}
      {mode === "edit" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {editState.status === "idle" || editState.status === "error" ? (
            <div className="flex flex-1 flex-col gap-4 p-4">
              <div className="rounded-2xl border border-violet-200/60 bg-violet-50/80 p-4">
                <p className="text-xs font-semibold text-violet-700 mb-1">🤖 Brian editor</p>
                <p className="text-[11px] leading-5 text-slate-500">
                  Describe the change you want. The AI reads every file and edits the right one.
                  You&apos;ll preview the diff before anything is written.
                </p>
              </div>

              {editState.status === "error" && (
                <div className="rounded-2xl border border-red-200/60 bg-red-50/80 p-3">
                  <p className="text-xs font-medium text-red-700">{editState.message}</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <textarea
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
                    e.preventDefault();
                    void generateEdit();
                  }}
                  placeholder={
                    contextHint
                      ? "e.g. \"Add an open question to this file\"\n\"Summarize the risks in this node\"\n\"Connect this context to the architecture\""
                      : "e.g. \"Add Redis to the tech stack decisions\"\n\"Update the auth architecture to use JWT\"\n\"Add a note that the database uses connection pooling\""
                  }
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/15 transition-all"
                />
                <button
                  onClick={() => void generateEdit()}
                  disabled={!editInstruction.trim()}
                  className="w-full rounded-xl bg-violet-600 py-2.5 text-sm font-medium text-white shadow-md shadow-violet-300/30 transition hover:bg-violet-700 disabled:opacity-40"
                >
                  Generate edit
                </button>
              </div>

              <div className="mt-auto space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Example instructions</p>
                {[
                  "Add Redis caching to the architecture decisions",
                  "Update the API rate limits in the integration docs",
                  "Mark the auth decision as deprecated",
                ].map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setEditInstruction(ex)}
                    className="w-full rounded-xl border border-slate-200/60 bg-white/60 px-3 py-2 text-left text-[11px] text-slate-500 transition hover:bg-white/90 hover:text-slate-700"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : editState.status === "loading" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 animate-ping rounded-full bg-violet-400 opacity-30" />
                <div className="absolute inset-2 rounded-full bg-violet-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Reading the entire knowledge base…</p>
                <p className="mt-1 text-xs text-slate-400">The AI is generating the edit</p>
              </div>
            </div>
          ) : editState.status === "preview" ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Header */}
              <div className="border-b border-slate-200/60 bg-white/60 px-4 py-3 backdrop-blur-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Proposed edit</p>
                    <p className="mt-0.5 font-mono text-[10px] text-violet-600">{editState.file}</p>
                  </div>
                  <button onClick={resetEdit} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
                    <X size={13} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">{editState.summary}</p>
              </div>

              {/* Diff-style preview */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <DiffView original={editState.original} newContent={editState.newContent} />
              </div>

              {/* Apply bar */}
              <div className="border-t border-slate-200/60 bg-white/60 p-3 backdrop-blur-sm space-y-2">
                <button
                  onClick={() => void applyEdit()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-medium text-white shadow-md shadow-violet-300/30 transition hover:bg-violet-700"
                >
                  <CheckCircle size={15} />
                  Apply to brian/
                </button>
                <button
                  onClick={resetEdit}
                  className="w-full rounded-xl border border-slate-200/60 bg-white/60 py-2 text-xs text-slate-500 transition hover:bg-white/90"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : editState.status === "applying" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
              </div>
              <p className="text-sm font-medium text-slate-700">Writing to brian/…</p>
            </div>
          ) : editState.status === "applied" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 ring-2 ring-emerald-200/60">
                <CheckCircle size={26} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-800">Brian updated!</p>
                <p className="mt-1 font-mono text-xs text-violet-600">{editState.file}</p>
                <p className="mt-2 text-sm text-slate-500">{editState.summary}</p>
              </div>
              <p className="text-xs text-slate-400">Reload the page to see the graph update.</p>
              <button
                onClick={resetEdit}
                className="rounded-xl border border-slate-200/60 bg-white/70 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/90"
              >
                Make another edit
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Diff view ─────────────────────────────────────────────────────────────────

function DiffView({ original, newContent }: { original: string; newContent: string }) {
  const origLines = original.split("\n");
  const newLines = newContent.split("\n");

  // Simple line-by-line diff: mark removed/added/unchanged
  type DiffLine = { type: "same" | "removed" | "added"; text: string };
  const diff: DiffLine[] = [];

  // Use a simple LCS-based approach — for brevity use a greedy line diff
  const origSet = new Set(origLines);
  const newSet = new Set(newLines);

  // Find all unique removed lines
  const removed = origLines.filter((l) => !newSet.has(l));
  const added = newLines.filter((l) => !origSet.has(l));
  const removedSet = new Set(removed);
  const addedSet = new Set(added);

  // Build the diff by walking newContent lines then marking removed ones
  for (const line of newLines) {
    if (addedSet.has(line) && !origSet.has(line)) {
      diff.push({ type: "added", text: line });
    } else {
      diff.push({ type: "same", text: line });
    }
  }
  for (const line of removed) {
    if (removedSet.has(line)) {
      diff.unshift({ type: "removed", text: line });
    }
  }

  // If no changes detected just show new content
  const hasChanges = diff.some((d) => d.type !== "same");

  if (!hasChanges) {
    return (
      <div className="rounded-xl border border-slate-200/60 bg-slate-50/80 p-3">
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-600">
          {newContent}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/60 bg-slate-50/80 overflow-hidden">
      <div className="overflow-x-auto">
        {diff.map((line, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 px-3 py-px font-mono text-[11px] leading-5",
              line.type === "added" && "bg-emerald-50 text-emerald-800",
              line.type === "removed" && "bg-red-50 text-red-700 line-through opacity-60",
              line.type === "same" && "text-slate-600",
            )}
          >
            <span className="select-none text-slate-300 w-3">
              {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-all duration-150",
        active
          ? "bg-white/90 text-violet-700 shadow-sm ring-1 ring-slate-200/70"
          : "text-slate-500 hover:bg-white/60 hover:text-slate-700",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={cn(
        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ring-1",
        role === "assistant"
          ? "bg-violet-100 ring-violet-200/70 text-violet-600"
          : "bg-sky-100 ring-sky-200/70 text-sky-600",
      )}
    >
      {role === "assistant" ? <Bot size={13} /> : <User size={13} />}
    </div>
  );
}

function Dots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-violet-400"
          style={{ animation: `bounce 1s ${delay}ms infinite` }}
        />
      ))}
    </div>
  );
}

function stableKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
