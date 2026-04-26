"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, RefreshCw } from "lucide-react";

import { BrainCommand } from "@/components/brain-command";
import { ContextMapRebuildNotifier } from "@/components/context-map-rebuild-notifier";
import {
  buildGraphData,
  type BrianFile,
  type BrianFrontmatter,
} from "@/lib/brian/graph-builder";

type AgentFilesResponse = {
  brain_dir: string;
  source: "working" | "reference";
  files: Array<{ path: string; content: string; frontmatter: Record<string, unknown> }>;
};

const importanceOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function normalizeFrontmatter(fm: Record<string, unknown>): BrianFrontmatter {
  const out: BrianFrontmatter = {};
  if (typeof fm.id === "string") out.id = fm.id;
  if (typeof fm.type === "string") out.type = fm.type;
  if (typeof fm.title === "string") out.title = fm.title;
  if (typeof fm.status === "string") out.status = fm.status;
  if (typeof fm.updated === "string") out.updated = fm.updated;
  if (
    fm.importance === "critical" ||
    fm.importance === "high" ||
    fm.importance === "medium" ||
    fm.importance === "low"
  ) {
    out.importance = fm.importance;
  }
  if (Array.isArray(fm.links)) out.links = fm.links.filter((x): x is string => typeof x === "string");
  if (Array.isArray(fm.keywords))
    out.keywords = fm.keywords.filter((x): x is string => typeof x === "string");
  return out;
}

function sortFiles(files: BrianFile[]): BrianFile[] {
  return [...files].sort((a, b) => {
    const ao = importanceOrder[a.frontmatter.importance ?? "medium"] ?? 2;
    const bo = importanceOrder[b.frontmatter.importance ?? "medium"] ?? 2;
    if (ao !== bo) return ao - bo;
    return a.path.localeCompare(b.path);
  });
}

export default function BrainPage() {
  const [files, setFiles] = useState<BrianFile[] | null>(null);
  const [meta, setMeta] = useState<{ brainDir: string; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/files", { cache: "no-store" });
      const body = (await res.json()) as AgentFilesResponse | { error?: string; agent_url?: string };
      if (!res.ok || !("files" in body)) {
        const err = "error" in body ? body.error : `Agent /files failed (${res.status})`;
        throw new Error(err ?? "Unknown error");
      }
      const next = sortFiles(
        body.files.map((f) => ({
          path: f.path,
          content: f.content,
          frontmatter: normalizeFrontmatter(f.frontmatter ?? {}),
        })),
      );
      setFiles(next);
      setMeta({ brainDir: body.brain_dir, source: body.source });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach agent");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onContextMapRebuildDone = useCallback(() => {
    setTimeout(() => {
      void load();
    }, 250);
  }, [load]);

  const graphData = useMemo(() => buildGraphData(files ?? []), [files]);

  if (files === null && loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Loading brain from agent…
        </div>
      </div>
    );
  }

  if (files === null && error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold text-slate-900">Can&apos;t reach the brain agent</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <p className="text-xs text-slate-400">
            Make sure the agent is running (default <code>http://localhost:8000</code>) and that{" "}
            <code>AGENT_API_URL</code> is set if it&apos;s elsewhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw size={12} />
            Retry
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <ChevronLeft size={12} />
            Back to start
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <ContextMapRebuildNotifier onRebuildDone={onContextMapRebuildDone} />
      <BrainCommand files={files ?? []} graphData={graphData} />
      {/* Floating refresh / source indicator so it's visually clear which agent
          the graph is reflecting. */}
      <div className="pointer-events-none fixed right-4 top-4 z-30 flex items-center gap-2">
        {meta && (
          <span
            className="pointer-events-auto rounded-full border border-black/10 bg-white/85 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500 shadow-sm backdrop-blur"
            title={meta.brainDir}
          >
            {meta.source === "working" ? "live agent brain" : "reference brain"} ·{" "}
            {(files ?? []).length} files
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white disabled:opacity-50"
          title="Re-fetch the brain from the connected agent"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>
    </>
  );
}
