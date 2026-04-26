"use client";

import { BrainHomeLanding } from "@/components/brain-home-landing";

export function HomeClient({ hasBrain }: { hasBrain: boolean }) {
  return <BrainHomeLanding hasBrain={hasBrain} />;
}

