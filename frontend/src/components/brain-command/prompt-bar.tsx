"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";

type Answer = { markdown: string; sources: string[] };

type Message = {
  role: "user" | "assistant";
  content: string;
};

function statusLabel(s: string) {
  if (s === "classifying") return "Determining intent…";
  if (s === "chatting") return "Answering…";
  if (s === "updating") return "Preparing update…";
  if (s === "done") return "Done";
  if (s === "error") return "Error";
  return "Ready";
}

export function PromptBar({
  status,
  onStatusChange,
  onAnswer,
}: {
  status: "idle" | "classifying" | "chatting" | "updating" | "done" | "error";
  onStatusChange: (s: "idle" | "classifying" | "chatting" | "updating" | "done" | "error") => void;
  onAnswer: (a: Answer | null) => void;
}) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{
    instruction: string;
    file: string;
    summary: string;
  } | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = useMemo(() => {
    return text.trim().length > 0 && !streaming && status !== "classifying" && status !== "updating";
  }, [text, streaming, status]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const next = Math.min(140, Math.max(48, ta.scrollHeight));
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
        const preview = (await previewRes.json()) as { summary?: string; file?: string; error?: string };

        const md = previewRes.ok
          ? `**Proposed update**\n\n- File: \`${String(preview.file ?? "")}\`\n- Summary: ${String(preview.summary ?? "")}\n\nUse **Apply update** below to write it to disk.`
          : `Could not generate an update preview.\n\n${String(preview.error ?? "Unknown error")}`;

        onAnswer({ markdown: md, sources: preview.file ? [preview.file] : [] });
        if (previewRes.ok && preview.file && preview.summary) {
          setPendingUpdate({ instruction, file: preview.file, summary: preview.summary });
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
    setSources([]);

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

      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(err.error ?? err.detail ?? `Chat failed (${res.status})`);
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
            setSources(msg.sources);
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
    }
  }, [messages, onAnswer, onStatusChange, sources, text]);

  const applyPending = useCallback(async () => {
    if (!pendingUpdate) return;
    onStatusChange("updating");
    try {
      const res = await fetch("/api/brian/ai-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: pendingUpdate.instruction, apply: true }),
      });
      const data = (await res.json()) as { summary?: string; file?: string; error?: string };
      if (!res.ok) {
        onAnswer({ markdown: `Apply failed.\n\n${String(data.error ?? "Unknown error")}`, sources: [] });
        onStatusChange("error");
        return;
      }
      onAnswer({
        markdown: `**Applied update**\n\n- File: \`${String(data.file ?? pendingUpdate.file)}\`\n- Summary: ${String(data.summary ?? pendingUpdate.summary)}`,
        sources: [String(data.file ?? pendingUpdate.file)],
      });
      setPendingUpdate(null);
      onStatusChange("done");
    } catch (e) {
      onAnswer({ markdown: `Apply failed: ${e instanceof Error ? e.message : "Unknown error"}`, sources: [] });
      onStatusChange("error");
    }
  }, [onAnswer, onStatusChange, pendingUpdate]);

  return (
    <div className="glass px-4 py-3">
      <div className="flex items-end gap-3">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask anything or describe an update…"
          className={cn(
            "min-h-12 w-full resize-none rounded-2xl border border-black/10 bg-white/70 px-4 py-3",
            "text-[13px] leading-6 text-black placeholder:text-black/40 outline-none",
            "focus:border-black/25 focus:bg-white/90",
          )}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-2xl border transition",
            canSend
              ? "border-transparent bg-[color:var(--accent-600)] text-white hover:bg-[color:var(--accent-700)]"
              : "border-black/10 bg-white/60 text-black/35",
          )}
          title="Send (⌘/Ctrl + Enter)"
        >
          {streaming || status === "classifying" || status === "updating" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 px-1">
        <p className="text-[10px] font-medium text-black/55">
          {statusLabel(status)}
        </p>
        <div className="flex items-center gap-2">
          {pendingUpdate && (
            <button
              type="button"
              onClick={() => void applyPending()}
              className="rounded-full bg-black/[0.06] px-3 py-1 text-[10px] font-semibold text-black/80 transition hover:bg-black/[0.10] hover:text-black"
              title={`Apply update to ${pendingUpdate.file}`}
            >
              Apply update
            </button>
          )}
          <p className="text-[10px] text-black/40">
            ⌘/Ctrl + Enter to submit
          </p>
        </div>
      </div>
    </div>
  );
}

