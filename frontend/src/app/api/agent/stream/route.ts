import { NextRequest } from "next/server";

import { getBootstrapWebSocketUrlForClient } from "@/lib/bootstrap-ws-url";

/** Prefer 127.0.0.1 so Node fetch matches browser WS (avoids IPv6 localhost quirks). */
const AGENT_API = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

function withBootstrapWsUrl(payload: Record<string, unknown>) {
  const bootstrap_ws_url = getBootstrapWebSocketUrlForClient();
  if (bootstrap_ws_url) payload.bootstrap_ws_url = bootstrap_ws_url;
  return Response.json(payload);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_API}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: `Cannot reach agent API at ${AGENT_API}: ${msg}` })}\n\ndata: {"type":"stream_end"}\n\n`,
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: `Agent API error ${upstream.status}: ${text}` })}\n\ndata: {"type":"stream_end"}\n\n`,
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export async function GET() {
  try {
    let res = await fetch(`${AGENT_API}/tools`, { cache: "no-store" });
    if (!res.ok) {
      res = await fetch(`${AGENT_API}/health`, { cache: "no-store" });
    }
    if (!res.ok) throw new Error(`agent ${res.status}`);
    const data = res.ok && res.headers.get("content-type")?.includes("json")
      ? ((await res.json()) as Record<string, unknown>)
      : {};
    if (!("reader" in data) && !("writer" in data)) {
      return withBootstrapWsUrl({
        reader: [
          "list_reference_brain", "read_reference_file", "search_reference_brain",
          "list_working_brain", "read_working_file", "search_working_brain",
          "get_working_frontmatter", "semantic_search", "get_brief",
        ],
        writer: ["upsert_working_file", "replace_working_file", "propose_update", "record_audit"],
        graph: null,
        offline: false,
      });
    }
    return withBootstrapWsUrl({ ...data, offline: false });
  } catch {
    return withBootstrapWsUrl({
      reader: [
        "list_reference_brain", "read_reference_file", "search_reference_brain",
        "list_working_brain", "read_working_file", "search_working_brain",
        "get_working_frontmatter", "semantic_search", "get_brief",
      ],
      writer: ["upsert_working_file", "replace_working_file", "propose_update", "record_audit"],
      graph: null,
      offline: true,
    });
  }
}
