import { NextRequest, NextResponse } from "next/server";

import { parseSource } from "@/lib/ingest/normalizers";
import { verifyWebhook } from "@/lib/ingest/security";
import { ingestPayload } from "@/lib/ingest/service";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  const { source: rawSource } = await context.params;
  const source = parseSource(rawSource);

  if (!source || source === "manual") {
    return NextResponse.json({ error: "Unsupported ingestion source" }, { status: 404 });
  }

  const rawBody = await request.text();
  const verified = await verifyWebhook(request, rawBody, source);
  if (!verified) {
    return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 401 });
  }

  const payload = safeJson(rawBody);

  if (source === "slack" && typeof payload === "object" && payload && "challenge" in payload) {
    return NextResponse.json({ challenge: (payload as { challenge: string }).challenge });
  }

  const result = await ingestPayload(source, payload);
  return NextResponse.json({
    ok: true,
    eventId: result.event.id,
    status: result.brainUpdate ? "brain_updated" : "stored",
    brainUpdateId: result.brainUpdate?.id,
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  const { source } = await context.params;

  return NextResponse.json({
    ok: true,
    endpoint: `/api/ingest/${source}`,
    instructions: "POST webhook payloads here. Configure source-specific secrets in environment variables for verification.",
  });
}

function safeJson(rawBody: string) {
  try {
    return JSON.parse(rawBody);
  } catch {
    return { text: rawBody };
  }
}
