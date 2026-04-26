import { NextResponse } from "next/server";

const AGENT_API = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

type TriggerRequest = {
  instruction?: string;
  file?: string;
  newContent?: string;
  summary?: string;
};

export async function POST(req: Request) {
  const { instruction, file, newContent, summary } = (await req.json()) as TriggerRequest;

  if (!instruction?.trim() || !file?.trim() || typeof newContent !== "string") {
    return NextResponse.json(
      { error: "instruction, file, and newContent are required" },
      { status: 400 },
    );
  }

  const prompt = [
    "Apply this user-approved Brian update.",
    "",
    `Original instruction: ${instruction.trim()}`,
    `Target file: ${file.trim()}`,
    summary?.trim() ? `Summary: ${summary.trim()}` : null,
    "",
    "Replace the target file with this complete Markdown content, preserving it exactly unless a required brain invariant would be violated:",
    "",
    "BEGIN TARGET FILE CONTENT",
    newContent,
    "END TARGET FILE CONTENT",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_API}/context-map/rebuild-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        label: "brain-command-apply",
        source: {
          kind: "brain-command",
          action: "apply-update",
          file,
          instruction,
          summary,
        },
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Cannot reach agent API at ${AGENT_API}: ${message}` },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error:
          typeof data.detail === "string"
            ? data.detail
            : `Agent update trigger failed (${upstream.status})`,
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json(data);
}
