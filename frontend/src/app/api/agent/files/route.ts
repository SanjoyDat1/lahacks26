import { NextResponse } from "next/server";

import { readBrianFiles, resolveBrianDir } from "@/lib/brian/reader";

export const dynamic = "force-dynamic";

export async function GET() {
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
