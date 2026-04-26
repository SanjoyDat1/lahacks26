import type { Metadata } from "next";
import { AgentObservatory } from "@/components/agent-observatory";

export const metadata: Metadata = {
  title: "Agent Observatory — Brian",
  description: "Watch your Brian agent think, read, and act in real time.",
};

export default function AgentPage() {
  return <AgentObservatory />;
}
