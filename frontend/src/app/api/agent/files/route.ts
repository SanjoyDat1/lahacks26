import { NextResponse } from "next/server";

import { readBrianFiles, resolveBrianDir } from "@/lib/brian/reader";

export const dynamic = "force-dynamic";

const AGENT_API = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

type AgentFilePayload = {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
};

type AgentFilesJson = {
  brain_dir: string;
  source: string;
  files: AgentFilePayload[];
};

/**
 * Prefer the live brain-api `/files` response so the graph matches what bootstrap wrote
 * (including a custom `BRAIN_DIR`). Fall back to reading `resolveBrianDir()` from disk
 * when the agent is unreachable.
 */
export async function GET() {
  try {
    const upstream = await fetch(`${AGENT_API}/files`, { cache: "no-store" });
    if (upstream.ok) {
      const body = (await upstream.json()) as AgentFilesJson;
      if (Array.isArray(body.files)) {
        return NextResponse.json(body, {
          headers: { "cache-control": "no-store" },
        });
      }
    }
  } catch {
    /* use local tree */
  }

  try {
    const brainDir = resolveBrianDir();
    const files = readBrianFiles();
    return NextResponse.json(
      {
        brain_dir: brainDir,
        source: "working" as const,
        files,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Failed to read brain directory: ${msg}` },
      { status: 500 },
    );
  }
}
