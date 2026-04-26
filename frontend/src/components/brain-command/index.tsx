"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrianFile, GraphData } from "@/lib/brian/reader";
import { categoryOf, categoryShade, type BrainCategory } from "@/lib/brain/categories";

import { FilterChips } from "@/components/brain-command/filter-chips";
import { FileTree } from "@/components/brain-command/file-tree";
import { GraphCanvas } from "@/components/brain-command/graph-canvas";
import { PreviewPane } from "@/components/brain-command/preview-pane";
import { PromptBar } from "@/components/brain-command/prompt-bar";

type Props = {
  files: BrianFile[];
  graphData: GraphData;
};

type Answer = { markdown: string; sources: string[] };

export function BrainCommand({ files, graphData }: Props) {
  const categories = useMemo(() => {
    const set = new Set<BrainCategory>();
    for (const f of files) set.add(categoryOf(f.path));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [files]);

  const [activeCategories, setActiveCategories] = useState<Set<BrainCategory>>(
    () => new Set(),
  );
  const [selectedFile, setSelectedFile] = useState<BrianFile | null>(files[0] ?? null);
  const [lastAnswer, setLastAnswer] = useState<Answer | null>(null);
  const [status, setStatus] = useState<
    "idle" | "classifying" | "chatting" | "updating" | "done" | "error"
  >("idle");

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

  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);

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
          onSelectFile={(filePathOrId) => {
            const f = files.find(
              (x) => x.frontmatter.id === filePathOrId || x.path === filePathOrId,
            );
            if (f) setSelectedFile(f);
          }}
          visibleFilter={visibleFilter}
          colorOverride={colorOverride}
        />
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
            onSelect={(f) => setSelectedFile(f)}
            getTint={(p) => categoryShade(p)}
          />
        </section>

        {/* Center column is intentionally empty — graph is the background layer */}
        <section />

        {/* Right: preview */}
        <section ref={rightPanelRef} className="glass pointer-events-auto min-h-0 overflow-hidden">
          <PreviewPane
            file={selectedFile}
            lastAnswer={lastAnswer}
            allFiles={files}
            onSelectSource={(titleOrPath) => {
              const f =
                files.find((x) => x.path === titleOrPath) ??
                files.find((x) => (x.frontmatter.title ?? "") === titleOrPath);
              if (f) setSelectedFile(f);
            }}
            accentForPath={(p) => categoryShade(p)}
          />
        </section>
      </div>

      {/* Bottom prompt bar */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-4">
        <div className="mx-auto w-[min(560px,calc(100vw-32px))]">
          <PromptBar
            status={status}
            onStatusChange={setStatus}
            onAnswer={setLastAnswer}
          />
        </div>
      </div>
    </main>
  );
}

