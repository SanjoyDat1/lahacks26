import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import { NextRequest, NextResponse } from "next/server";

import { readBrianFiles, resolveBrianDir } from "@/lib/brian/reader";

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
      : existing.filter((link) => link !== targetLinkId && link !== target.path);

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

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request);
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
    return NextResponse.json({ ok: true, result: writeLinks(body.sourceId!, body.targetId!, "remove") });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
