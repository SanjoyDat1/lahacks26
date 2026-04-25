import { buildGraphData, readBrianFiles } from "@/lib/brian/reader";
import { BrainWorkspaceV2 } from "@/components/brain-workspace-v2";

export default function BrainPage() {
  const files = readBrianFiles();
  const graphData = buildGraphData(files);

  return <BrainWorkspaceV2 files={files} graphData={graphData} />;
}
