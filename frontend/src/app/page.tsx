import { HomeClient } from "@/components/home-client";
import { readBrianFiles } from "@/lib/brian/reader";

export default function Home() {
  const files = readBrianFiles();
  return <HomeClient hasBrain={files.length > 0} />;
}
