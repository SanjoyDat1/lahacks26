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

type AgentStreamEvent = {
  type?: string;
  content?: string;
  message?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
};

type StreamChunk = { delta?: string; sources?: string[] };

const PATH_INPUT_KEYS = [
  "relative_path",
  "path",
  "file_path",
  "target_path",
  "source_path",
  "dest_path",
];

const MD_PATH_RE = /(?:^|[\s`(\[])([A-Za-z0-9_./-]+\.md)(?=$|[\s`)\],:])/g;

function collectPathsFromInput(input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const key of PATH_INPUT_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.toLowerCase().endsWith(".md")) out.push(v);
  }
  return out;
}

function collectPathsFromText(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  MD_PATH_RE.lastIndex = 0;
  while ((m = MD_PATH_RE.exec(text)) !== null) out.push(m[1]!);
  return out;
}

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

function streamSse(initialSources: string[], iter: AsyncIterable<StreamChunk>) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources: initialSources })}\n\n`));
      try {
        for await (const chunk of iter) {
          if (!chunk || (!chunk.delta && !chunk.sources)) continue;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ delta: `\n\n[stream error] ${message}` } satisfies StreamChunk)}\n\n`,
          ),
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

async function* streamAgentEvents(
  upstream: Response,
  seedSources: string[],
): AsyncGenerator<StreamChunk> {
  if (!upstream.body) return;

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Track which brain files the agent has touched while deriving the answer.
  // Seed with the locally-computed relevance picks so the graph can light up
  // immediately while the agent's first tool calls are still in flight.
  const seen = new Set<string>(seedSources);

  function noteAndMaybeYield(paths: string[]): StreamChunk | null {
    let added = false;
    for (const p of paths) {
      const norm = p.replace(/^\.\//, "").trim();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      added = true;
    }
    return added ? { sources: Array.from(seen) } : null;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: AgentStreamEvent;
        try {
          parsed = JSON.parse(payload) as AgentStreamEvent;
        } catch {
          continue;
        }

        if (parsed.type === "token" && parsed.content) {
          yield { delta: parsed.content };
        } else if (parsed.type === "error" && parsed.message) {
          yield { delta: `\n\n[agent error] ${parsed.message}` };
        } else if (parsed.type === "tool_call") {
          const update = noteAndMaybeYield(collectPathsFromInput(parsed.input));
          if (update) yield update;
        } else if (parsed.type === "tool_result") {
          const update = noteAndMaybeYield(collectPathsFromText(parsed.output));
          if (update) yield update;
        }
      }
    }
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

  const sourcePaths = contextFiles.map((f) => f.path);

  // ── Primary path: proxy the connected agent's streaming endpoint ───────────
  // The agent already has the LLM key and brain context wired up correctly,
  // so this works even when the frontend has no OPENAI_API_KEY and no local
  // brain/ directory.
  try {
    const upstream = await fetch(`${AGENT_API}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: lastMessage, task: "query" }),
      cache: "no-store",
    });
    if (upstream.ok && upstream.body) {
      const stream = streamSse(sourcePaths, streamAgentEvents(upstream, sourcePaths));
      return new Response(stream, { headers: SSE_HEADERS });
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
            .join("\n\n")}\n\n*Sources: ${sourcePaths.join(", ")}*`
        : "I couldn't reach the brain agent and I don't have a local OpenAI key configured. Make sure the agent is running (default http://localhost:8000) or set OPENAI_API_KEY in frontend/.env.";

    return NextResponse.json({ content: fallback, sources: sourcePaths });
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

  async function* deltas(): AsyncGenerator<StreamChunk> {
    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) yield { delta };
    }
  }

  return new Response(streamSse(sourcePaths, deltas()), { headers: SSE_HEADERS });
}
