import { NextResponse } from "next/server";

const AGENT_API = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

type TriggerRequest = {
  instruction?: string;
  file?: string;
  newContent?: string;
  summary?: string;
  edits?: Array<{
    file?: string;
    newContent?: string;
    summary?: string;
  }>;
};

export async function POST(req: Request) {
  const { instruction, file, newContent, summary, edits } = (await req.json()) as TriggerRequest;

  const requestedEdits =
    Array.isArray(edits) && edits.length > 0
      ? edits
      : file && typeof newContent === "string"
        ? [{ file, newContent, summary }]
        : [];

  if (
    !instruction?.trim() ||
    requestedEdits.length === 0 ||
    requestedEdits.some((edit) => !edit.file?.trim() || typeof edit.newContent !== "string")
  ) {
    return NextResponse.json(
      { error: "instruction and at least one edit with file and newContent are required" },
      { status: 400 },
    );
  }

  const files = requestedEdits.map((edit) => edit.file?.trim() ?? "");

  const prompt = [
    "Apply these user-approved Brian updates.",
    "",
    `Original instruction: ${instruction.trim()}`,
    `Target files: ${files.join(", ")}`,
    summary?.trim() ? `Summary: ${summary.trim()}` : null,
    "",
    "For every target file below, replace that file with the matching complete Markdown content.",
    "Preserve the content exactly unless a required brain invariant would be violated.",
    "",
    ...requestedEdits.flatMap((edit, index) => [
      `BEGIN TARGET FILE ${index + 1}: ${edit.file?.trim()}`,
      edit.summary?.trim() ? `File summary: ${edit.summary.trim()}` : "",
      "BEGIN CONTENT",
      edit.newContent ?? "",
      "END CONTENT",
      `END TARGET FILE ${index + 1}`,
      "",
    ]),
  ]
    .filter((line): line is string => line !== null && line !== "")
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
          file: files[0],
          files,
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
