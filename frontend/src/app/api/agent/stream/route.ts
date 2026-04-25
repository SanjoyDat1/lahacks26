import { NextRequest } from "next/server";

const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:8000";

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
    const [toolsRes, healthRes] = await Promise.all([
      fetch(`${AGENT_API}/tools`),
      fetch(`${AGENT_API}/health`),
    ]);
    const data = await toolsRes.json();
    let bootstrap_ws_github = false;
    if (healthRes.ok) {
      const health = (await healthRes.json()) as { bootstrap_ws_github?: boolean };
      bootstrap_ws_github = health.bootstrap_ws_github === true;
    }
    return Response.json({ ...data, offline: false, bootstrap_ws_github });
  } catch {
    return Response.json(
      {
        reader: [
          "list_reference_brain", "read_reference_file", "search_reference_brain",
          "list_working_brain", "read_working_file", "search_working_brain",
          "get_working_frontmatter", "semantic_search", "get_brief",
        ],
        writer: ["upsert_working_file", "replace_working_file", "propose_update", "record_audit"],
        graph: null,
        offline: true,
        bootstrap_ws_github: false,
      },
      { status: 200 },
    );
  }
}
