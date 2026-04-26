"use client";

import type { BrianFile, GraphData } from "@/lib/brian/reader";
import { BrainCommand } from "@/components/brain-command";
import { OnboardingModal } from "@/components/brain-command/onboarding-modal";

export function HomeClient({
  files,
  graphData,
  needsBootstrap,
}: {
  files: BrianFile[];
  graphData: GraphData;
  needsBootstrap: boolean;
}) {
  return (
    <div className="relative">
      <BrainCommand files={files} graphData={graphData} />
      <OnboardingModal
        open={needsBootstrap}
        onDone={() => {
          window.location.assign("/brain");
        }}
      />
    </div>
  );
}

