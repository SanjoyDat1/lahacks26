import { HomeClient } from "@/components/home-client";
import { buildGraphData, readBrianFiles } from "@/lib/brian/reader";

export default function Home() {
  const files = readBrianFiles();
  const graphData = buildGraphData(files);
  const needsBootstrap = files.length === 0;

  // NOTE: BrainCommand is a client component; we pass server-read files into a client wrapper.
  return <HomeClient files={files} graphData={graphData} needsBootstrap={needsBootstrap} />;
}
