"use client";

import { useMemo, useState } from "react";
import { Loader2, GitBranch, Send } from "lucide-react";

import { cn } from "@/lib/utils";

const DEFAULT_PROMPT =
  "Build a transparent AI brain for this codebase from the linked GitHub repository. Focus on architecture, entry points, dependencies, and how the system fits together.";

function parseRepoSlugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const owner = parts[0] ?? "";
    const repo = (parts[1] ?? "").replace(/\.git$/i, "");
    if (!owner || !repo) return "";
    return `${owner}/${repo}`;
  } catch {
    return "";
  }
}

export function OnboardingModal({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = useMemo(() => parseRepoSlugFromUrl(repoUrl), [repoUrl]);

  async function run() {
    if (!repoUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: DEFAULT_PROMPT,
          github_repos: [{ repo_url: repoUrl.trim(), ref: ref.trim() || undefined }],
          overwrite: true,
          max_files: 20,
          apply: true,
          clone_timeout_s: 300,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        const d = data.detail;
        const msg = typeof d === "string" ? d : d != null ? JSON.stringify(d) : `Initialize failed (${res.status})`;
        setError(msg);
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Initialize request failed");
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl glass p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-black/[0.06]">
            <GitBranch size={16} className="text-black/75" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
              Bootstrap
            </p>
            <h1 className="mt-1 text-lg font-semibold text-black tracking-[-0.04em]">
              Connect a GitHub repo to generate the brain
            </h1>
            <p className="mt-1 text-[12px] leading-5 text-black/60">
              Everything lives in one view. Once the brain files exist, the graph + directory + preview will populate automatically.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-black/55">
              Repo URL
            </span>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-[13px] text-black outline-none placeholder:text-black/35 focus:border-black/25 focus:bg-white/90"
              disabled={busy}
            />
            {slug ? (
              <p className="mt-1 font-mono text-[10px] text-black/45">
                Detected: {slug}
              </p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-black/55">
              Branch (opt.)
            </span>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="main"
              className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-[13px] text-black outline-none placeholder:text-black/35 focus:border-black/25 focus:bg-white/90"
              disabled={busy}
            />
          </label>
        </div>

        {error ? (
          <div className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[10px] text-black/45">
            Public HTTPS repos only.
          </p>
          <button
            type="button"
            onClick={() => void run()}
            disabled={!repoUrl.trim() || busy}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition",
              !repoUrl.trim() || busy
                ? "bg-white/60 text-black/35 border border-black/10"
                : "bg-[color:var(--accent-600)] text-white hover:bg-[color:var(--accent-700)]",
            )}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? "Bootstrapping…" : "Generate brain"}
          </button>
        </div>
      </div>
    </div>
  );
}
