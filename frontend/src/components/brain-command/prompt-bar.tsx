"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Send } from "lucide-react";

import { uniqueBrainFileLabels } from "@/lib/brain/brain-file-label";
import type { BrianFile } from "@/lib/brian/reader";
import { cn } from "@/lib/utils";

type Answer = { markdown: string; sources: string[] };

type Message = {
  role: "user" | "assistant";
  content: string;
};

type PendingEdit = {
  file: string;
  newContent: string;
  summary: string;
};

const MAX_SEARCH_RESULTS = 6;

export function PromptBar({
  status,
  onStatusChange,
  onAnswer,
  onActiveSources,
  files,
  onSelectFile,
  attached = false,
}: {
  status: "idle" | "classifying" | "chatting" | "updating" | "done" | "error";
  onStatusChange: (s: "idle" | "classifying" | "chatting" | "updating" | "done" | "error") => void;
  onAnswer: (a: Answer | null) => void;
  /** Live set of brain file paths the agent has read while deriving the in-flight answer. */
  onActiveSources?: (sources: string[] | null) => void;
  files: BrianFile[];
  onSelectFile: (file: BrianFile) => void;
  attached?: boolean;
}) {
  const [text, setText] = useState("");
  const [showResults, setShowResults] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{
    instruction: string;
    edits: PendingEdit[];
    summary: string;
  } | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = useMemo(() => {
    return text.trim().length > 0 && !streaming && status !== "classifying" && status !== "updating";
  }, [text, streaming, status]);

  const labelByPath = useMemo(() => uniqueBrainFileLabels(files), [files]);

  const searchResults = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [] as BrianFile[];
    const matches: BrianFile[] = [];
    for (const f of files) {
      const display = (labelByPath.get(f.path) ?? f.path).toLowerCase();
      if (display.includes(q) || f.path.toLowerCase().includes(q)) {
        matches.push(f);
        if (matches.length >= MAX_SEARCH_RESULTS) break;
      }
    }
    return matches;
  }, [text, files, labelByPath]);

  const showSearchPanel = showResults && searchResults.length > 0 && !streaming;

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const next = Math.min(160, Math.max(36, ta.scrollHeight));
    ta.style.height = `${next}px`;
  }, [text]);

  const submit = useCallback(async () => {
    const instruction = text.trim();
    if (!instruction) return;

    setText("");
    onStatusChange("classifying");
    setPendingUpdate(null);

    let intent: "ask" | "update" = "ask";
    try {
      const res = await fetch("/api/brain/route-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await res.json()) as { intent?: "ask" | "update" };
      if (data.intent === "update") intent = "update";
    } catch {
      intent = "ask";
    }

    if (intent === "update") {
      onStatusChange("updating");
      try {
        const previewRes = await fetch("/api/brian/ai-edit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instruction, apply: false }),
        });
        const preview = (await previewRes.json()) as {
          summary?: string;
          edits?: PendingEdit[];
          file?: string;
          newContent?: string;
          error?: string;
        };

        const previewEdits =
          preview.edits && preview.edits.length > 0
            ? preview.edits
            : preview.file && preview.newContent
              ? [
                  {
                    file: preview.file,
                    newContent: preview.newContent,
                    summary: preview.summary ?? "Updated file.",
                  },
                ]
              : [];
        const fileList = previewEdits.map((edit) => `- File: \`${edit.file}\``).join("\n");
        const md = previewRes.ok
          ? `**Proposed update**\n\n${fileList}\n- Summary: ${String(preview.summary ?? "")}\n\nUse **Apply update** to write it to disk.`
          : `Could not generate an update preview.\n\n${String(preview.error ?? "Unknown error")}`;

        onAnswer({ markdown: md, sources: previewEdits.map((edit) => edit.file) });
        if (previewRes.ok && previewEdits.length > 0 && preview.summary) {
          setPendingUpdate({
            instruction,
            edits: previewEdits,
            summary: preview.summary,
          });
        }
        onStatusChange(previewRes.ok ? "done" : "error");
      } catch (e) {
        onAnswer({ markdown: `Update failed: ${e instanceof Error ? e.message : "Unknown error"}`, sources: [] });
        onStatusChange("error");
      }
      return;
    }

    onStatusChange("chatting");
    setStreaming(true);
    onActiveSources?.([]);

    const nextMessages: Message[] = [...messages, { role: "user", content: instruction }];
    setMessages(nextMessages);

    let out = "";
    let localSources: string[] = [];
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(err.error ?? err.detail ?? `Chat failed (${res.status})`);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { content?: string; sources?: string[] };
        const md = data.content ?? "";
        out = md;
        localSources = data.sources ?? [];
        onActiveSources?.(localSources);
        setMessages([...nextMessages, { role: "assistant", content: out }]);
        onAnswer({ markdown: out, sources: localSources });
        onStatusChange("done");
        return;
      }

      if (!res.body) {
        throw new Error("Chat returned an empty response");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const p of parts) {
          const line = p.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          const msg = JSON.parse(payload) as { delta?: string; sources?: string[] };
          if (msg.sources?.length) {
            localSources = msg.sources;
            onActiveSources?.(localSources);
          }
          if (msg.delta) {
            out += msg.delta;
            onAnswer({ markdown: out, sources: localSources });
          }
        }
      }

      setMessages([...nextMessages, { role: "assistant", content: out }]);
      onAnswer({ markdown: out, sources: localSources });
      onStatusChange("done");
    } catch (e) {
      onAnswer({ markdown: `Chat failed: ${e instanceof Error ? e.message : "Unknown error"}`, sources: [] });
      onStatusChange("error");
    } finally {
      setStreaming(false);
      onActiveSources?.(null);
    }
  }, [messages, onActiveSources, onAnswer, onStatusChange, text]);

  const applyPending = useCallback(async () => {
    if (!pendingUpdate || status === "updating") return;
    onStatusChange("updating");
    try {
      const res = await fetch("/api/agent/update-trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: pendingUpdate.instruction,
          edits: pendingUpdate.edits,
          summary: pendingUpdate.summary,
        }),
      });
      const data = (await res.json()) as { run_id?: string; error?: string };
      if (!res.ok) {
        onAnswer({ markdown: `Update trigger failed.\n\n${String(data.error ?? "Unknown error")}`, sources: [] });
        onStatusChange("error");
        return;
      }
      const files = pendingUpdate.edits.map((edit) => edit.file);
      const fileLines = files.map((file) => `- File: \`${file}\``).join("\n");
      onAnswer({
        markdown: `**Update started**\n\n${fileLines}\n- Summary: ${pendingUpdate.summary}\n- Run: \`${String(data.run_id ?? "started")}\`\n\nOpen the top-right notification to follow the backend logs. Brian will refresh when the run completes.`,
        sources: files,
      });
      setPendingUpdate(null);
      onStatusChange("done");
    } catch (e) {
      onAnswer({ markdown: `Update trigger failed: ${e instanceof Error ? e.message : "Unknown error"}`, sources: [] });
      onStatusChange("error");
    }
  }, [onAnswer, onStatusChange, pendingUpdate, status]);

  return (
    <div className="relative">
      {showSearchPanel && (
        <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-black/10 bg-white/95 shadow-xl backdrop-blur-md">
          <div className="border-b border-black/[0.06] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-black/45">
            Pages matching “{text.trim()}”
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {searchResults.map((f) => {
              const title = labelByPath.get(f.path) ?? f.path;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSelectFile(f);
                      setText("");
                      setShowResults(false);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-black/[0.05]"
                  >
                    <FileText size={14} className="mt-0.5 flex-shrink-0 text-black/55" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] leading-tight text-black">
                        {title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] leading-tight text-black/50">
                        {f.path}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div
        className={cn(
          "flex min-w-0 items-end gap-2 border border-black/10 bg-white/85 py-2 pl-4 pr-2 backdrop-blur-md transition",
          attached
            ? "rounded-t-none rounded-b-2xl shadow-none"
            : "rounded-2xl shadow-lg",
          "focus-within:border-black/25 focus-within:bg-white/95",
        )}
      >
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setShowResults(true);
          }}
          placeholder="Ask, search pages, or describe an update…"
          className={cn(
            "min-h-9 min-w-0 w-full flex-1 resize-none border-0 bg-transparent py-2",
            "text-[13px] leading-6 text-black placeholder:text-black/40 outline-none",
          )}
          onKeyDown={(e) => {
            if (e.key === "Escape" && showSearchPanel) {
              setShowResults(false);
              return;
            }
            if (e.key !== "Enter") return;
            // Shift+Enter (without ⌘/Ctrl) = new line; Enter or ⌘/Ctrl+Enter = send
            if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
            e.preventDefault();
            setShowResults(false);
            void submit();
          }}
        />

        {!text && !pendingUpdate && (
          <span
            className="pointer-events-none hidden max-w-[9rem] flex-shrink-0 select-none self-center text-right text-[10px] font-medium leading-tight text-black/40 sm:inline"
            aria-hidden
          >
            Enter or ⌘↵ send · Shift+↵ newline
          </span>
        )}

        {pendingUpdate && (
          <button
            type="button"
            onClick={() => void applyPending()}
            disabled={status === "updating"}
            className={cn(
              "mb-0.5 inline-flex h-9 flex-shrink-0 items-center justify-center rounded-xl px-3 text-[10px] font-semibold transition",
              status === "updating"
                ? "bg-black/[0.04] text-black/35"
                : "bg-black/[0.06] text-black/80 hover:bg-black/[0.10] hover:text-black",
            )}
            title={`Apply update to ${pendingUpdate.edits.length} file${pendingUpdate.edits.length === 1 ? "" : "s"}`}
          >
            Apply update
          </button>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          className={cn(
            "mb-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition",
            canSend
              ? "border-transparent bg-[color:var(--accent-600)] text-white hover:bg-[color:var(--accent-700)]"
              : "border-black/10 bg-white/60 text-black/35",
          )}
          title="Send (Enter or ⌘/Ctrl+Enter)"
        >
          {streaming || status === "classifying" || status === "updating" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

