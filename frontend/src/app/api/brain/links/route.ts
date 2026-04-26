import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import { NextRequest, NextResponse } from "next/server";

import { readBrianFiles, resolveBrianDir } from "@/lib/brian/reader";

export const dynamic = "force-dynamic";

const AGENT_API = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

type LinkBody = {
  sourceId?: string;
  targetId?: string;
};

function findFile(idOrPath: string) {
  const files = readBrianFiles();
  return files.find((file) => file.frontmatter.id === idOrPath || file.path === idOrPath);
}

function writeLinks(sourceId: string, targetId: string, action: "add" | "remove") {
  const source = findFile(sourceId);
  const target = findFile(targetId);

  if (!source || !target) {
    throw new Error("Could not find source or target brain file.");
  }

  const targetLinkId = target.frontmatter.id ?? target.path;
  const full = path.join(resolveBrianDir(), source.path);
  const raw = fs.readFileSync(full, "utf8");
  const parsed = matter(raw);
  const existing = Array.isArray(parsed.data.links) ? parsed.data.links.map(String) : [];
  const nextLinks =
    action === "add"
      ? Array.from(new Set([...existing, targetLinkId]))
      : existing.filter(
          (link) => link !== targetLinkId && link !== target.path && link !== targetId,
        );

  parsed.data.links = nextLinks;
  parsed.data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(full, matter.stringify(parsed.content.trim() + "\n", parsed.data), "utf8");

  return {
    source: source.frontmatter.id ?? source.path,
    target: targetLinkId,
    sourcePath: source.path,
    links: nextLinks,
  };
}

async function parseBody(request: NextRequest): Promise<LinkBody> {
  const body = (await request.json()) as LinkBody;
  if (!body.sourceId || !body.targetId) {
    throw new Error("sourceId and targetId are required");
  }
  if (body.sourceId === body.targetId) {
    throw new Error("A file cannot link to itself.");
  }
  return body;
}

function agentErrorFromPayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === "string") return d.detail;
  if (Array.isArray(d.detail)) {
    return d.detail
      .map((x) => {
        if (x && typeof x === "object" && "msg" in x) return String((x as { msg: unknown }).msg);
        return JSON.stringify(x);
      })
      .join("; ");
  }
  if (typeof d.error === "string") return d.error;
  return null;
}

/**
 * When the Python agent is up, persist link edits to the same working tree as
 * `GET /files`. On connection errors only, fall back to the Next.js process
 * brain directory (matches `/api/agent/files` fallback).
 */
async function tryAgentLinkMutation(
  method: "POST" | "DELETE",
  body: { sourceId: string; targetId: string },
): Promise<NextResponse | null> {
  try {
    const upstream = await fetch(`${AGENT_API}/links`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId: body.sourceId, targetId: body.targetId }),
      cache: "no-store",
    });
    const data: unknown = await upstream.json().catch(() => ({}));
    if (upstream.ok) {
      return NextResponse.json(data as object, { status: 200 });
    }
    const msg = agentErrorFromPayload(data) ?? `Agent returned ${upstream.status}`;
    return NextResponse.json({ error: msg }, { status: upstream.status >= 500 ? 502 : upstream.status });
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request);
    const agentRes = await tryAgentLinkMutation("POST", {
      sourceId: body.sourceId!,
      targetId: body.targetId!,
    });
    if (agentRes) return agentRes;
    return NextResponse.json({ ok: true, result: writeLinks(body.sourceId!, body.targetId!, "add") });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await parseBody(request);
    const agentRes = await tryAgentLinkMutation("DELETE", {
      sourceId: body.sourceId!,
      targetId: body.targetId!,
    });
    if (agentRes) return agentRes;
    return NextResponse.json({ ok: true, result: writeLinks(body.sourceId!, body.targetId!, "remove") });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
