"use client";

import type { GraphData, GraphLink, GraphNode } from "@/lib/brian/reader";
import type { Relevance } from "@/lib/brian/scenarios";
import { BrainGraph } from "@/components/brain-graph";

export function GraphCanvas({
  graphData,
  selectedId,
  selectedEdge,
  flashEdge,
  highlightMap,
  onSelectFile,
  onEdgeSelect,
  onEdgeDelete,
  onLinkCreate,
  visibleFilter,
  colorOverride,
}: {
  graphData: GraphData;
  selectedId?: string;
  selectedEdge?: GraphLink | null;
  flashEdge?: GraphLink | null;
  highlightMap?: Map<string, Relevance>;
  onSelectFile: (filePathOrId: string) => void;
  onEdgeSelect?: (edge: GraphLink | null) => void;
  onEdgeDelete?: (edge: GraphLink) => void;
  onLinkCreate?: (sourceId: string, targetId: string) => Promise<void>;
  visibleFilter: (node: { id: string; path?: string }) => boolean;
  colorOverride: (node: { id: string; path?: string }) => string;
}) {
  return (
    <div className="relative h-full">
      <BrainGraph
        graphData={graphData}
        selectedId={selectedId}
        selectedEdge={selectedEdge ?? null}
        flashEdge={flashEdge ?? null}
        highlightMap={highlightMap}
        onNodeSelect={(node: GraphNode | null) => {
          onEdgeSelect?.(null);
          if (!node) return;
          onSelectFile(node.id || node.path);
        }}
        onEdgeSelect={onEdgeSelect}
        onEdgeDelete={onEdgeDelete}
        onLinkCreate={onLinkCreate}
        visibleFilter={visibleFilter}
        colorOverride={colorOverride}
        theme="light"
        minimal
      />
    </div>
  );
}
