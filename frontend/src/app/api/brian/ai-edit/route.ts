import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";
import OpenAI from "openai";

import { env } from "@/lib/env";
import { resolveBrianDir } from "@/lib/brian/reader";

// Read every .md file in the brian/ directory with its raw content (incl. frontmatter)
function readAllRaw(): Array<{ relPath: string; raw: string }> {
  const brianDir = resolveBrianDir();
  if (!fs.existsSync(brianDir)) return [];
  const out: Array<{ relPath: string; raw: string }> = [];
  collectRaw(brianDir, brianDir, out);
  return out;
}

function collectRaw(
  base: string,
  cur: string,
  out: Array<{ relPath: string; raw: string }>,
) {
  for (const entry of fs.readdirSync(cur)) {
    const full = path.join(cur, entry);
    if (fs.statSync(full).isDirectory()) {
      collectRaw(base, full, out);
    } else if (entry.endsWith(".md")) {
      out.push({
        relPath: path.relative(base, full).replace(/\\/g, "/"),
        raw: fs.readFileSync(full, "utf8"),
      });
    }
  }
}

function writeBrianFile(relPath: string, content: string) {
  const full = path.join(resolveBrianDir(), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

type EditResult = {
  file: string;
  original: string;
  newContent: string;
  summary: string;
};

const TODAY = new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are an expert knowledge-base editor for a software team.
You have full read access to every file in the "brian/" knowledge base directory.
The user will give you an instruction describing a change they want.

Rules:
1. Choose exactly ONE file to edit (the most relevant one).
2. Return the COMPLETE new file content, including the YAML frontmatter block (---).
3. Always update the frontmatter "updated" field to today: ${TODAY}.
4. Preserve all existing frontmatter fields unless the instruction explicitly changes them.
5. Keep the same overall file structure (headings, sections) unless told otherwise.
6. Be precise — only change what the instruction asks for.
7. Return valid JSON with this exact shape:
   { "file": "relative/path.md", "newContent": "...", "summary": "one sentence describing what changed" }`;

export async function POST(req: Request) {
  const { instruction, apply } = (await req.json()) as {
    instruction: string;
    apply?: boolean;
  };

  if (!instruction?.trim()) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  const allFiles = readAllRaw();
  if (!allFiles.length) {
    return NextResponse.json({ error: "No brian files found" }, { status: 404 });
  }

  // Build context block — list every file with its full content
  const contextBlock = allFiles
    .map((f) => `### File: ${f.relPath}\n\n${f.raw}`)
    .join("\n\n---\n\n");

  const userMessage = `Here are all the current files in the brian/ knowledge base:\n\n${contextBlock}\n\n---\n\nUser instruction: "${instruction}"\n\nReturn a JSON object with the complete updated file content.`;

  if (!env.openaiApiKey) {
    return NextResponse.json(
      {
        error:
          "An OpenAI API key is required for AI-powered brain editing. Add OPENAI_API_KEY to your .env file.",
      },
      { status: 400 },
    );
  }

  const openai = new OpenAI({ apiKey: env.openaiApiKey });

  let result: EditResult;
  try {
    const response = await openai.chat.completions.create({
      model: env.openaiModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const parsed = JSON.parse(
      response.choices[0]?.message.content ?? "{}",
    ) as Partial<EditResult>;

    if (!parsed.file || !parsed.newContent || !parsed.summary) {
      throw new Error("LLM returned incomplete JSON");
    }

    // Find the original content for diffing
    const original =
      allFiles.find((f) => f.relPath === parsed.file)?.raw ?? "";

    result = {
      file: parsed.file,
      original,
      newContent: parsed.newContent,
      summary: parsed.summary,
    };
  } catch (err) {
    console.error("AI edit failed", err);
    return NextResponse.json(
      { error: "AI edit generation failed. Check server logs." },
      { status: 500 },
    );
  }

  // Optionally persist the change
  if (apply) {
    try {
      writeBrianFile(result.file, result.newContent);
    } catch (err) {
      console.error("Failed to write brian file", err);
      return NextResponse.json(
        { error: "Generated edit but failed to write file." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(result);
}
