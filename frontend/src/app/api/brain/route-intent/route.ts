import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";

import { env } from "@/lib/env";

const IntentResponseSchema = z.object({
  intent: z.enum(["ask", "update"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

function heuristicIntent(instruction: string) {
  const s = instruction.toLowerCase();

  const updateHints = [
    "add ",
    "update ",
    "change ",
    "remove ",
    "delete ",
    "set ",
    "rename ",
    "replace ",
    "fix ",
    "document ",
    "write ",
    "edit ",
    "refactor ",
  ];
  const askHints = [
    "what ",
    "where ",
    "how ",
    "why ",
    "who ",
    "which ",
    "explain ",
    "summarize ",
    "list ",
    "show ",
  ];

  const updateScore = updateHints.reduce((acc, h) => acc + (s.includes(h) ? 1 : 0), 0);
  const askScore = askHints.reduce((acc, h) => acc + (s.includes(h) ? 1 : 0), 0);

  if (updateScore > askScore) {
    return { intent: "update" as const, confidence: 0.62, reason: "Detected change-oriented verbs in the instruction." };
  }
  if (askScore > updateScore) {
    return { intent: "ask" as const, confidence: 0.62, reason: "Detected question-oriented language in the instruction." };
  }
  return { intent: "ask" as const, confidence: 0.51, reason: "Defaulting to Q&A when intent is ambiguous." };
}

export async function POST(req: NextRequest) {
  let instruction = "";
  try {
    const body = (await req.json()) as { instruction?: unknown };
    instruction = typeof body.instruction === "string" ? body.instruction : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!instruction.trim()) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  if (!env.openaiApiKey) {
    return NextResponse.json(heuristicIntent(instruction));
  }

  const openai = new OpenAI({ apiKey: env.openaiApiKey });

  const system = [
    "You are a router for a single input box in a product UI.",
    "Classify whether the user's instruction is (A) asking for information or (B) requesting an update to the project's brain files.",
    "Return strict JSON only with: { intent: \"ask\" | \"update\", confidence: number 0..1, reason: string }.",
    "Use intent=update when the user requests changing/adding/editing content. Use intent=ask when they want explanation or information.",
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: env.openaiModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: instruction },
      ],
    });

    const raw = completion.choices[0]?.message.content ?? "{}";
    const parsed = IntentResponseSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return NextResponse.json(heuristicIntent(instruction));
    return NextResponse.json(parsed.data);
  } catch {
    return NextResponse.json(heuristicIntent(instruction));
  }
}

