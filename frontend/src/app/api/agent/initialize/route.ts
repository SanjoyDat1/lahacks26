import { NextRequest, NextResponse } from "next/server";

const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:8000";

/** Proxies to the agent ``POST /initialize`` (GitHub + text context; no WebSocket). */
export async function POST(request: NextRequest) {
  const body = await request.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_API}/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { detail: `Cannot reach agent API at ${AGENT_API}: ${msg}` },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    data = { detail: text || `Agent returned ${upstream.status}` };
  }

  return NextResponse.json(data, { status: upstream.status });
}
