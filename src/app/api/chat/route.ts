import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { readBrianFiles } from "@/lib/brian/reader";
import { env } from "@/lib/env";

type Message = { role: "user" | "assistant" | "system"; content: string };

export async function POST(request: NextRequest) {
  const { messages } = (await request.json()) as { messages: Message[] };
  const lastMessage = messages.at(-1)?.content ?? "";

  const brianFiles = readBrianFiles();

  const query = lastMessage.toLowerCase();
  const terms = query.split(/\s+/).filter((w) => w.length > 2);

  const scored = brianFiles
    .map((f) => {
      const haystack =
        `${f.frontmatter.title ?? ""} ${f.frontmatter.keywords?.join(" ") ?? ""} ${f.content}`.toLowerCase();
      const score = terms.reduce(
        (acc, term) => acc + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { file: f, score };
    })
    .sort((a, b) => b.score - a.score);

  const topByRelevance = scored
    .filter((s) => s.score > 0)
    .slice(0, 4)
    .map((s) => s.file);

  const alwaysInclude = brianFiles.filter(
    (f) =>
      f.frontmatter.importance === "critical" ||
      f.frontmatter.type === "summary",
  );

  const contextFiles = [
    ...new Map(
      [...topByRelevance, ...alwaysInclude.slice(0, 2)].map((f) => [
        f.path,
        f,
      ]),
    ).values(),
  ].slice(0, 6);

  const sourceNames = contextFiles.map(
    (f) => f.frontmatter.title ?? f.path,
  );

  const brainContext = contextFiles
    .map(
      (f) =>
        `--- ${f.frontmatter.title ?? f.path} (${f.frontmatter.type})\n${f.content.slice(0, 1800)}`,
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
                `**${f.frontmatter.title ?? f.path}** (${f.frontmatter.type})\n${f.content
                  .split("\n")
                  .filter((l) => l.trim() && !l.startsWith("#"))
                  .slice(0, 4)
                  .join(" ")}`,
            )
            .join("\n\n")}\n\n*Sources: ${sourceNames.join(", ")}*`
        : "I couldn't find specific information about that. Try asking about the architecture, decisions, goals, or integrations.";

    return NextResponse.json({ content: fallback, sources: sourceNames });
  }

  const openai = new OpenAI({ apiKey: env.openaiApiKey });

  const allMessages: Message[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const stream = await openai.chat.completions.create({
    model: env.openaiModel,
    messages: allMessages,
    stream: true,
    temperature: 0.3,
    max_tokens: 1200,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ sources: sourceNames })}\n\n`,
        ),
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`),
          );
        }
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
