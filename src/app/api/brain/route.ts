import { NextRequest, NextResponse } from "next/server";

import { ensureBrainDefaults, readBrain, writeBrainFile } from "@/lib/brain/provider";
import { listBrainUpdates } from "@/lib/db/store";

export async function GET() {
  await ensureBrainDefaults();
  const [files, updates] = await Promise.all([readBrain(), listBrainUpdates()]);
  return NextResponse.json({ files, updates });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json()) as {
    path?: string;
    content?: string;
    message?: string;
  };

  if (!body.path || typeof body.content !== "string") {
    return NextResponse.json({ error: "path and content are required" }, { status: 400 });
  }

  const commit = await writeBrainFile({
    path: body.path,
    content: body.content,
    message: body.message || `brain: human edit ${body.path}`,
  });

  return NextResponse.json({ ok: true, commit });
}

export async function POST() {
  const results = await ensureBrainDefaults();
  return NextResponse.json({ ok: true, initialized: results.length });
}
