"use client";

import { useMemo, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";

import type { BrainFile, BrainUpdate } from "@/lib/types";

export function BrainWorkspace({
  files,
  updates,
}: {
  files: BrainFile[];
  updates: BrainUpdate[];
}) {
  const [selectedPath, setSelectedPath] = useState(files[0]?.path ?? "");
  const selected = useMemo(() => files.find((file) => file.path === selectedPath) ?? files[0], [files, selectedPath]);
  const [content, setContent] = useState(selected?.content ?? "");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function select(path: string) {
    const next = files.find((file) => file.path === path);
    setSelectedPath(path);
    setContent(next?.content ?? "");
    setStatus(undefined);
  }

  function save() {
    startTransition(async () => {
      const response = await fetch("/api/brain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: selected?.path,
          content,
          message: message || `brain: human edit ${selected?.path}`,
        }),
      });

      setStatus(response.ok ? "Saved and committed." : "Save failed.");
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr_360px]">
      <aside className="rounded-3xl border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-2xl">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Brain files</h2>
        <div className="space-y-1">
          {files.map((file) => (
            <button
              key={file.path}
              onClick={() => select(file.path)}
              className={`w-full rounded-2xl px-3 py-2 text-left text-sm transition-all duration-150 ${
                selected?.path === file.path
                  ? "bg-violet-100/80 text-violet-700 shadow-sm ring-1 ring-violet-200/60"
                  : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-800"
              }`}
            >
              {file.path.replace("brain/", "")}
            </button>
          ))}
        </div>
      </aside>

      <section className="rounded-3xl border border-white/80 bg-white/65 p-5 shadow-sm backdrop-blur-2xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-semibold text-slate-800">{selected?.path}</h1>
          <button
            onClick={save}
            disabled={isPending}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-violet-300/30 transition hover:bg-violet-700 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Commit edit"}
          </button>
        </div>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Commit message"
          className="mb-3 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/15 transition-all"
        />
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="min-h-[520px] w-full rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 font-mono text-sm leading-6 text-slate-700 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/10 transition-all"
        />
        {status ? <p className="mt-3 text-sm text-violet-700 font-medium">{status}</p> : null}
      </section>

      <aside className="space-y-5">
        <section className="rounded-3xl border border-white/80 bg-white/65 p-5 shadow-sm backdrop-blur-2xl">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</h2>
          <div className="prose prose-slate max-w-none text-sm">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </section>

        <section className="rounded-3xl border border-white/80 bg-white/65 p-5 shadow-sm backdrop-blur-2xl">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent updates</h2>
          <div className="space-y-3">
            {updates.length ? (
              updates.map((update) => (
                <div key={update.id} className="rounded-2xl border border-slate-200/50 bg-white/70 p-3 text-sm">
                  <p className="font-semibold text-slate-800">{update.status}</p>
                  <p className="mt-0.5 text-slate-500">{update.rationale}</p>
                  <p className="mt-2 text-[10px] font-mono text-slate-400">{update.commitSha}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No AI brain updates yet.</p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
