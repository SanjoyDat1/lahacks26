import { buildGraphData, readBrianFiles } from "@/lib/brian/reader";
import { BrainCommand } from "@/components/brain-command";

export default function BrainPage() {
  const files = readBrianFiles();
  const graphData = buildGraphData(files);

  return <BrainCommand files={files} graphData={graphData} />;
}
