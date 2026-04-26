"use client";

import type { GraphData } from "@/lib/brian/reader";
import { BrainGraph } from "@/components/brain-graph";

export function GraphCanvas({
  graphData,
  selectedId,
  onSelectFile,
  visibleFilter,
  colorOverride,
}: {
  graphData: GraphData;
  selectedId?: string;
  onSelectFile: (filePathOrId: string) => void;
  visibleFilter: (node: { id: string; path?: string }) => boolean;
  colorOverride: (node: { id: string; path?: string }) => string;
}) {
  return (
    <div className="relative h-full">
      <BrainGraph
        graphData={graphData}
        selectedId={selectedId}
        onNodeSelect={(node) => {
          if (!node) return;
          onSelectFile(node.id || node.path);
        }}
        onEdgeSelect={() => {}}
        onLinkCreate={async () => {}}
        visibleFilter={visibleFilter}
        colorOverride={colorOverride}
        theme="light"
        minimal
      />
    </div>
  );
}

