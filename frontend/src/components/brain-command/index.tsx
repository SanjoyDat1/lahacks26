"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrianFile, GraphData, GraphLink } from "@/lib/brian/reader";
import type { Relevance } from "@/lib/brian/scenarios";
import {
  buildBrianPathLookup,
  resolveBrainLinkHref,
} from "@/lib/brian/resolve-markdown-link";
import { categoryOf, categoryShade, type BrainCategory } from "@/lib/brain/categories";
import { addGraphLink, removeGraphLink } from "@/lib/brain/graph-link-mutations";
import { cn } from "@/lib/utils";

import { AnswerCard } from "@/components/brain-command/answer-card";
import { FilterChips } from "@/components/brain-command/filter-chips";
import { FileTree } from "@/components/brain-command/file-tree";
import { GraphCanvas } from "@/components/brain-command/graph-canvas";
import { PreviewPane } from "@/components/brain-command/preview-pane";
import { PromptBar } from "@/components/brain-command/prompt-bar";
import { ChevronLeft, Link2, Loader2, Unlink, X } from "lucide-react";

type Props = {
  files: BrianFile[];
  graphData: GraphData;
};

type Answer = { markdown: string; sources: string[] };

type DocBundle = { files: BrianFile[]; graphData: GraphData };

export function BrainCommand({ files: serverFiles, graphData: serverGraphData }: Props) {
  const router = useRouter();
  const [bundle, setBundle] = useState<DocBundle>(() => ({
    files: serverFiles,
    graphData: serverGraphData,
  }));

  useEffect(() => {
    setBundle({ files: serverFiles, graphData: serverGraphData });
  }, [serverFiles, serverGraphData]);

  const { files, graphData } = bundle;

  const categories = useMemo(() => {
    const set = new Set<BrainCategory>();
    for (const f of files) set.add(categoryOf(f.path));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const [activeCategories, setActiveCategories] = useState<Set<BrainCategory>>(
    () => new Set(),
  );
  const [selectedFile, setSelectedFile] = useState<BrianFile | null>(() => serverFiles[0] ?? null);

  useEffect(() => {
    setSelectedFile((prev) => {
      if (!bundle.files.length) return null;
      if (prev) {
        return bundle.files.find((f) => f.path === prev.path) ?? bundle.files[0] ?? null;
      }
      return bundle.files[0] ?? null;
    });
  }, [bundle]);
  const [lastAnswer, setLastAnswer] = useState<Answer | null>(null);
  const [status, setStatus] = useState<
    "idle" | "classifying" | "chatting" | "updating" | "done" | "error"
  >("idle");
  const [selectedEdge, setSelectedEdge] = useState<GraphLink | null>(null);
  const [flashEdge, setFlashEdge] = useState<GraphLink | null>(null);
  /** Brain file paths the agent has read while deriving the in-flight answer. */
  const [activeSources, setActiveSources] = useState<string[] | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const flashEdgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashEdgeTimerRef.current) clearTimeout(flashEdgeTimerRef.current);
    };
  }, []);

  const filteredFiles = useMemo(() => {
    if (activeCategories.size === 0) return files;
    return files.filter((f) => activeCategories.has(categoryOf(f.path)));
  }, [files, activeCategories]);

  const visibleFilter = useMemo(() => {
    return (node: { path?: string }) => {
      const p = node.path ?? "";
      const cat = categoryOf(p);
      return activeCategories.size === 0 ? true : activeCategories.has(cat);
    };
  }, [activeCategories]);

  const colorOverride = useMemo(() => {
    return (node: { path?: string }) => categoryShade(node.path ?? "");
  }, []);

  const highlightMap = useMemo<Map<string, Relevance> | undefined>(() => {
    if (!activeSources || activeSources.length === 0) return undefined;
    const map = new Map<string, Relevance>();
    for (const path of activeSources) {
      // Mark by both the raw path and the dotted node id, so the graph picks
      // it up regardless of which key the node uses.
      map.set(path, "primary");
      const dotted = path.replace(/\.md$/i, "").replace(/\//g, ".");
      map.set(dotted, "primary");
    }
    return map;
  }, [activeSources]);

  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const bundleRef = useRef(bundle);
  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

  const mutateGraphLink = useCallback(async (method: "POST" | "DELETE", sourceId: string, targetId: string) => {
    const res = await fetch("/api/brain/links", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, targetId }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `Request failed (${res.status})`);
    }
  }, []);

  const onLinkCreate = useCallback(
    async (sourceId: string, targetId: string) => {
      const before = bundleRef.current;
      let next: DocBundle;
      try {
        next = addGraphLink(before.graphData, before.files, sourceId, targetId);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Could not add link");
        return;
      }
      if (next.graphData === before.graphData) {
        return;
      }
      setBundle(next);
      setLinkBusy(true);
      try {
        await mutateGraphLink("POST", sourceId, targetId);
        setSelectedEdge(null);
        const beforeKeys = new Set(
          before.graphData.links.map((l) => `${l.source}\0${l.target}`),
        );
        const added = next.graphData.links.find(
          (l) => !beforeKeys.has(`${l.source}\0${l.target}`),
        );
        if (added) {
          if (flashEdgeTimerRef.current) clearTimeout(flashEdgeTimerRef.current);
          setFlashEdge(added);
          flashEdgeTimerRef.current = setTimeout(() => {
            flashEdgeTimerRef.current = null;
            setFlashEdge(null);
          }, 1700);
        }
      } catch (e) {
        setBundle(before);
        void router.refresh();
        window.alert(e instanceof Error ? e.message : "Could not create link");
      } finally {
        setLinkBusy(false);
      }
    },
    [mutateGraphLink, router],
  );

  const removeEdge = useCallback(
    async (edge: GraphLink) => {
      const before = bundleRef.current;
      const next = removeGraphLink(before.graphData, before.files, edge.source, edge.target);
      if (next.graphData.links.length === before.graphData.links.length) return;
      setBundle(next);
      setLinkBusy(true);
      try {
        await mutateGraphLink("DELETE", edge.source, edge.target);
        setSelectedEdge(null);
      } catch (e) {
        setBundle(before);
        void router.refresh();
        window.alert(e instanceof Error ? e.message : "Could not remove link");
      } finally {
        setLinkBusy(false);
      }
    },
    [mutateGraphLink, router],
  );

  const onRemoveSelectedLink = useCallback(() => {
    if (!selectedEdge) return;
    void removeEdge(selectedEdge);
  }, [selectedEdge, removeEdge]);

  const edgeSourceFile = useMemo(() => {
    if (!selectedEdge) return null;
    return (
      files.find((f) => f.frontmatter.id === selectedEdge.source || f.path === selectedEdge.source) ?? null
    );
  }, [files, selectedEdge]);

  const edgeTargetFile = useMemo(() => {
    if (!selectedEdge) return null;
    return (
      files.find((f) => f.frontmatter.id === selectedEdge.target || f.path === selectedEdge.target) ?? null
    );
  }, [files, selectedEdge]);

  // Block browser-level zoom (trackpad pinch / Ctrl+wheel) over the side
  // panels so only the central graph reacts to zoom gestures. React's
  // synthetic onWheel is registered as passive and can't preventDefault
  // browser zoom, so we attach native non-passive listeners here.
  useEffect(() => {
    const blockZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const left = leftPanelRef.current;
    const right = rightPanelRef.current;
    left?.addEventListener("wheel", blockZoom, { passive: false });
    right?.addEventListener("wheel", blockZoom, { passive: false });
    return () => {
      left?.removeEventListener("wheel", blockZoom);
      right?.removeEventListener("wheel", blockZoom);
    };
  }, []);

  return (
    <main className="relative h-screen overflow-hidden">
      <div className="absolute inset-0 canvas-dots opacity-[0.18]" />

      {/* Graph sits underneath everything (no z-index here so the graph's
          internal hover tooltip can escape this stacking context and appear
          above the side panels). */}
      <div className="absolute inset-0">
        <GraphCanvas
          graphData={graphData}
          selectedId={selectedFile?.frontmatter.id ?? selectedFile?.path}
          selectedEdge={selectedEdge}
          flashEdge={flashEdge}
          highlightMap={highlightMap}
          onSelectFile={(filePathOrId) => {
            setSelectedEdge(null);
            const f = files.find(
              (x) => x.frontmatter.id === filePathOrId || x.path === filePathOrId,
            );
            if (f) setSelectedFile(f);
          }}
          onEdgeSelect={(edge) => {
            setSelectedEdge(edge);
            if (edge) {
              const src =
                files.find((x) => x.frontmatter.id === edge.source || x.path === edge.source) ?? null;
              if (src) setSelectedFile(src);
            }
          }}
          onEdgeDelete={(edge) => void removeEdge(edge)}
          onLinkCreate={onLinkCreate}
          visibleFilter={visibleFilter}
          colorOverride={colorOverride}
        />
      </div>

      <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-black/75 shadow-sm backdrop-blur-md transition hover:bg-white hover:text-black"
        >
          <ChevronLeft size={12} />
          Back to start
        </Link>
      </div>

      {/* Top floating filter chips */}
      <div className="absolute left-1/2 top-4 z-20 w-[min(1040px,calc(100vw-32px))] -translate-x-1/2">
        <FilterChips
          categories={categories}
          active={activeCategories}
          onChange={setActiveCategories}
        />
      </div>

      {/* Layout grid — passes pointer events through so the graph below stays interactive */}
      <div className="pointer-events-none relative z-10 grid h-full grid-cols-[280px_1fr_340px] gap-4 px-4 pb-24 pt-16">
        {/* Left: file tree */}
        <section ref={leftPanelRef} className="glass pointer-events-auto min-h-0 overflow-hidden">
          <FileTree
            files={filteredFiles}
            selectedPath={selectedFile?.path}
            onSelect={(f) => {
              setSelectedEdge(null);
              setSelectedFile(f);
            }}
            getTint={(p) => categoryShade(p)}
          />
        </section>

        {/* Center column is intentionally empty — graph is the background layer */}
        <section />

        {/* Right: preview */}
        <section ref={rightPanelRef} className="glass pointer-events-auto min-h-0 overflow-hidden">
          <PreviewPane
            file={selectedFile}
            allFiles={files}
            onSelectSource={(titleOrPath) => {
              const f =
                files.find((x) => x.path === titleOrPath) ??
                files.find((x) => (x.frontmatter.title ?? "") === titleOrPath) ??
                resolveBrainLinkHref(
                  titleOrPath,
                  selectedFile?.path ?? null,
                  buildBrianPathLookup(files),
                );
              if (f) setSelectedFile(f);
            }}
            accentForPath={(p) => categoryShade(p)}
          />
        </section>
      </div>

      {selectedEdge && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-[25] flex justify-center px-4 pb-2 sm:bottom-32">
          <div
            className="pointer-events-auto flex max-w-[min(520px,calc(100vw-32px))] items-center gap-3 rounded-2xl border border-black/10 bg-white/95 px-4 py-2.5 text-[13px] shadow-xl shadow-black/10 backdrop-blur-md"
            role="status"
          >
            <Link2 size={16} className="shrink-0 text-black/55" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-black/90">Selected link</div>
              <div className="truncate text-black/60">
                {edgeSourceFile?.frontmatter.title ?? edgeSourceFile?.path ?? selectedEdge.source}
                <span className="mx-1.5 text-black/35">→</span>
                {edgeTargetFile?.frontmatter.title ?? edgeTargetFile?.path ?? selectedEdge.target}
              </div>
            </div>
            <button
              type="button"
              disabled={linkBusy}
              onClick={() => void onRemoveSelectedLink()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
            >
              {linkBusy ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
              Remove
            </button>
            <button
              type="button"
              disabled={linkBusy}
              onClick={() => setSelectedEdge(null)}
              className="rounded-lg p-1.5 text-black/45 transition hover:bg-black/[0.06] hover:text-black/70"
              aria-label="Dismiss link selection"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Bottom prompt bar with attached answer card */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-10">
        <div
          className={cn(
            "mx-auto flex w-[min(640px,calc(100vw-32px))] flex-col",
            lastAnswer && "rounded-2xl shadow-lg",
          )}
        >
          {lastAnswer ? (
            <AnswerCard
              answer={lastAnswer}
              attached
              onClose={() => setLastAnswer(null)}
              onSelectSource={(titleOrPath) => {
                const f =
                  files.find((x) => x.path === titleOrPath) ??
                  files.find((x) => (x.frontmatter.title ?? "") === titleOrPath);
                if (f) {
                  setSelectedEdge(null);
                  setSelectedFile(f);
                }
              }}
              accentForPath={(p) => categoryShade(p)}
            />
          ) : null}
          <PromptBar
            status={status}
            onStatusChange={setStatus}
            onAnswer={setLastAnswer}
            onActiveSources={setActiveSources}
            files={files}
            attached={!!lastAnswer}
            onSelectFile={(f) => {
              setSelectedEdge(null);
              setSelectedFile(f);
            }}
          />
        </div>
      </div>
    </main>
  );
}

