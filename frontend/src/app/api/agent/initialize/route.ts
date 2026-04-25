import { NextRequest, NextResponse } from "next/server";

const AGENT_API = (process.env.AGENT_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

type GithubRepoInput = {
  repo_url: string;
  ref?: string | null;
  include_globs?: string[];
  exclude_globs?: string[];
  max_files?: number;
  max_chars?: number;
};

type InitializeBody = {
  prompt?: string;
  context?: string;
  sources?: string[];
  github_repos?: GithubRepoInput[];
  overwrite?: boolean;
  max_files?: number;
  apply?: boolean;
  clone_timeout_s?: number;
};

/** Proxies to ``POST /initialize``, or ``POST /github/ingest`` if the agent has no ``/initialize`` route (404). */
export async function POST(request: NextRequest) {
  let body: InitializeBody;
  try {
    body = (await request.json()) as InitializeBody;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body" }, { status: 400 });
  }

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

  if (upstream.status === 404) {
    const fb = await tryGithubIngestFallback(body);
    if (fb) return fb;
    return NextResponse.json(
      {
        detail:
          `Brain agent at ${AGENT_API} has no POST /initialize (404). ` +
          "Start it from this repo: cd agent && uv run brain-api. " +
          "If you use Docker, set AGENT_API_URL to the correct service URL (not localhost from inside the container).",
      },
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

async function tryGithubIngestFallback(body: InitializeBody): Promise<NextResponse | null> {
  const repos = body.github_repos?.filter((r) => r.repo_url?.trim()) ?? [];
  if (repos.length === 0) return null;

  if (repos.length > 1) {
    return NextResponse.json(
      {
        detail:
          `Agent at ${AGENT_API} has no POST /initialize (404). This fallback only supports one GitHub repo. ` +
          "Remove extra URLs or set AGENT_API_URL to a brain-api that exposes /initialize.",
      },
      { status: 502 },
    );
  }

  const r = repos[0]!;
  const ingestPayload = {
    repo_url: r.repo_url.trim(),
    ref: r.ref?.trim() || undefined,
    include_globs: r.include_globs ?? [],
    exclude_globs: r.exclude_globs ?? [],
    max_files: r.max_files ?? 200,
    max_chars: r.max_chars ?? 120_000,
    clone_timeout_s: body.clone_timeout_s ?? 300,
    apply: body.apply !== false,
    overwrite: body.overwrite !== false,
    brain_max_files: body.max_files ?? 24,
    additional_instructions: (body.prompt ?? "").trim(),
  };

  let ingestRes: Response;
  try {
    ingestRes = await fetch(`${AGENT_API}/github/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ingestPayload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        detail:
          `POST /initialize returned 404 and POST /github/ingest failed: ${msg}. ` +
          `Check AGENT_API_URL (currently ${AGENT_API}) points at brain-api on port 8000.`,
      },
      { status: 502 },
    );
  }

  const text = await ingestRes.text();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { detail: text || `github/ingest returned ${ingestRes.status}` },
      { status: ingestRes.status },
    );
  }

  if (!ingestRes.ok) {
    if (ingestRes.status === 404) {
      return NextResponse.json(
        {
          detail:
            `Neither POST /initialize nor POST /github/ingest was found on ${AGENT_API}. ` +
            "Run the API from the lahacks26 agent package: cd agent && uv run brain-api",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(raw, { status: ingestRes.status });
  }

  const written = raw.written_files;
  const normalized = {
    ok: true,
    mode: "initialize" as const,
    result_text: String(raw.result_text ?? ""),
    applied: raw.applied ?? true,
    written_files: Array.isArray(written) ? (written as string[]) : [],
    github_repos: [],
    content_truncated: Boolean(raw.content_truncated),
  };

  return NextResponse.json(normalized, { status: 200 });
}
