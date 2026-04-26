import { NextRequest } from "next/server";

const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:8000";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.info("[agent-proxy] stream start", {
    requestId,
    task: body?.task,
    promptChars: typeof body?.prompt === "string" ? body.prompt.length : 0,
    upstream: `${AGENT_API}/stream`,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_API}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[agent-proxy] upstream connect failed", { requestId, message: msg });
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
    console.error("[agent-proxy] upstream error", {
      requestId,
      status: upstream.status,
      body: text.slice(0, 1000),
    });
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

  console.info("[agent-proxy] upstream connected", {
    requestId,
    status: upstream.status,
    contentType: upstream.headers.get("content-type"),
  });

  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  const loggedTypes = new Map<string, number>();

  const tracedBody = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw) as { type?: string; tool?: string; agent?: string };
            const type = evt.type ?? "unknown";
            eventCount += 1;
            loggedTypes.set(type, (loggedTypes.get(type) ?? 0) + 1);
            if (type !== "token" && type !== "thinking") {
              console.info("[agent-proxy] sse event", {
                requestId,
                eventCount,
                type,
                agent: evt.agent,
                tool: evt.tool,
              });
            }
            if (type === "stream_end") {
              console.info("[agent-proxy] stream end", {
                requestId,
                eventCount,
                eventTypes: Object.fromEntries(loggedTypes),
              });
            }
          } catch {
            console.warn("[agent-proxy] failed to parse sse event", { requestId, raw: raw.slice(0, 300) });
          }
        }
      },
      flush() {
        if (buffer.trim()) {
          console.info("[agent-proxy] trailing stream buffer", {
            requestId,
            trailingChars: buffer.length,
          });
        }
      },
    }),
  );

  return new Response(tracedBody, {
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
    const res = await fetch(`${AGENT_API}/tools`);
    const data = await res.json();
    return Response.json(data);
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
      },
      { status: 200 },
    );
  }
}
