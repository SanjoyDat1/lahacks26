import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { readBrianFiles } from "@/lib/brian/reader";
import { env } from "@/lib/env";

type Message = { role: "user" | "assistant" | "system"; content: string };

const AGENT_API = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

type AgentFilePayload = {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
};

type AgentFilesJson = {
  brain_dir: string;
  source: string;
  files: AgentFilePayload[];
};

/**
 * Build chat context from the agent's `/files` endpoint when available, so the
 * chat sees the same brain the graph view sees (reference brain when the
 * working brain is empty, custom BRAIN_DIR, etc.). Falls back to scanning the
 * Next.js process's local working brain.
 */
async function loadBrainFiles(): Promise<AgentFilePayload[]> {
  try {
    const upstream = await fetch(`${AGENT_API}/files`, { cache: "no-store" });
    if (upstream.ok) {
      const body = (await upstream.json()) as AgentFilesJson;
      if (Array.isArray(body.files) && body.files.length > 0) {
        return body.files;
      }
    }
  } catch {
    /* fall through to local scan */
  }
  return readBrianFiles().map((f) => ({
    path: f.path,
    content: f.content,
    frontmatter: f.frontmatter as Record<string, unknown>,
  }));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

function streamSse(sources: string[], iter: AsyncIterable<string>) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`));
      try {
        for await (const delta of iter) {
          if (!delta) continue;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ delta: `\n\n[stream error] ${message}` })}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
} as const;

async function* chunkText(text: string, size = 80) {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
    // small breath so the UI gets a streaming feel
    await new Promise((r) => setTimeout(r, 8));
  }
}

export async function POST(request: NextRequest) {
  const { messages } = (await request.json()) as { messages: Message[] };
  const lastMessage = messages.at(-1)?.content ?? "";

  const brianFiles = await loadBrainFiles();

  const query = lastMessage.toLowerCase();
  const terms = query.split(/\s+/).filter((w) => w.length > 2);

  const scored = brianFiles
    .map((f) => {
      const title = asString(f.frontmatter?.title) ?? "";
      const keywords = asStringArray(f.frontmatter?.keywords) ?? [];
      const haystack = `${title} ${keywords.join(" ")} ${f.content}`.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
      return { file: f, score };
    })
    .sort((a, b) => b.score - a.score);

  const topByRelevance = scored
    .filter((s) => s.score > 0)
    .slice(0, 4)
    .map((s) => s.file);

  const alwaysInclude = brianFiles.filter(
    (f) =>
      asString(f.frontmatter?.importance) === "critical" ||
      asString(f.frontmatter?.type) === "summary",
  );

  const matchedContextFiles = [
    ...new Map(
      [...topByRelevance, ...alwaysInclude.slice(0, 2)].map((f) => [f.path, f]),
    ).values(),
  ].slice(0, 6);
  const contextFiles = matchedContextFiles.length > 0 ? matchedContextFiles : brianFiles.slice(0, 4);

  const sourceNames = contextFiles.map((f) => asString(f.frontmatter?.title) ?? f.path);

  // ── Primary path: delegate to the connected agent's /query endpoint ────────
  // The agent already has the LLM key and brain context wired up correctly,
  // so this works even when the frontend has no OPENAI_API_KEY and no local
  // brain/ directory.
  try {
    const upstream = await fetch(`${AGENT_API}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: lastMessage }),
      cache: "no-store",
    });
    if (upstream.ok) {
      const data = (await upstream.json()) as { result_text?: string };
      const text = (data.result_text ?? "").trim();
      if (text) {
        const stream = streamSse(sourceNames, chunkText(text));
        return new Response(stream, { headers: SSE_HEADERS });
      }
    }
  } catch {
    /* fall through to local OpenAI / fallback below */
  }

  // ── Fallback path: use frontend OpenAI key + local brain context ──────────

  const brainContext = contextFiles
    .map(
      (f) =>
        `--- ${asString(f.frontmatter?.title) ?? f.path} (${asString(f.frontmatter?.type) ?? "note"})\n${f.content.slice(0, 1800)}`,
    )
    .join("\n\n");

  const systemPrompt = `You are Brian, an intelligent knowledge assistant for this software project. You have deep knowledge of the project's architecture, decisions, goals, integrations, and constraints based on the project brain files below.

Answer questions concisely, accurately, and helpfully. Reference specific files when relevant. If you don't know, say so clearly.

Project brain context:
${brainContext}`;

  if (!env.openaiApiKey) {
    const fallback =
      contextFiles.length > 0
        ? `Here is what I found in the project brain:\n\n${contextFiles
            .map(
              (f) =>
                `**${asString(f.frontmatter?.title) ?? f.path}** (${asString(f.frontmatter?.type) ?? "note"})\n${f.content
                  .split("\n")
                  .filter((l) => l.trim() && !l.startsWith("#"))
                  .slice(0, 4)
                  .join(" ")}`,
            )
            .join("\n\n")}\n\n*Sources: ${sourceNames.join(", ")}*`
        : "I couldn't reach the brain agent and I don't have a local OpenAI key configured. Make sure the agent is running (default http://localhost:8000) or set OPENAI_API_KEY in frontend/.env.";

    return NextResponse.json({ content: fallback, sources: sourceNames });
  }

  const openai = new OpenAI({ apiKey: env.openaiApiKey });

  const allMessages: Message[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const completion = await openai.chat.completions.create({
    model: env.openaiModel,
    messages: allMessages,
    stream: true,
    temperature: 0.3,
    max_tokens: 1200,
  });

  async function* deltas() {
    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) yield delta;
    }
  }

  return new Response(streamSse(sourceNames, deltas()), { headers: SSE_HEADERS });
}
