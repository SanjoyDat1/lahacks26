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

function resolveBrianFilePath(relPath: string) {
  const brianDir = path.resolve(resolveBrianDir());
  const full = path.resolve(brianDir, relPath);
  if (full !== brianDir && !full.startsWith(`${brianDir}${path.sep}`)) {
    throw new Error("Refusing to write outside the brian directory");
  }
  return full;
}

function writeBrianFile(relPath: string, content: string) {
  const full = resolveBrianFilePath(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

type EditResult = {
  file: string;
  original: string;
  newContent: string;
  summary: string;
};

type MultiEditResult = {
  edits: EditResult[];
  summary: string;
};

const TODAY = new Date().toISOString().slice(0, 10);

const SYSTEM_PROMPT = `You are an expert knowledge-base editor for a software team.
You have full read access to every file in the "brian/" knowledge base directory.
The user will give you an instruction describing a change they want.

Rules:
1. Edit every file that is relevant to the requested change. If only one file is relevant, return one edit.
2. For each edited file, return the COMPLETE new file content, including the YAML frontmatter block (---).
3. For each edited file, always update the frontmatter "updated" field to today: ${TODAY}.
4. Preserve all existing frontmatter fields unless the instruction explicitly changes them.
5. Keep the same overall file structure (headings, sections) unless told otherwise.
6. Be precise — only change what the instruction asks for.
7. Return valid JSON with this exact shape:
   { "edits": [{ "file": "relative/path.md", "newContent": "...", "summary": "one sentence describing what changed in this file" }], "summary": "one sentence describing the full update" }`;

export async function POST(req: Request) {
  const { instruction, apply, file, newContent, summary, edits } = (await req.json()) as {
    instruction: string;
    apply?: boolean;
    file?: string;
    newContent?: string;
    summary?: string;
    edits?: Array<{
      file?: string;
      newContent?: string;
      summary?: string;
    }>;
  };

  if (!instruction?.trim()) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  const allFiles = readAllRaw();
  if (!allFiles.length) {
    return NextResponse.json({ error: "No brian files found" }, { status: 404 });
  }

  const requestedEdits =
    Array.isArray(edits) && edits.length > 0
      ? edits
      : file && typeof newContent === "string"
        ? [{ file, newContent, summary }]
        : [];

  if (apply && requestedEdits.length > 0) {
    try {
      for (const edit of requestedEdits) {
        if (!edit.file?.trim() || typeof edit.newContent !== "string") {
          return NextResponse.json(
            { error: "Each edit requires file and newContent." },
            { status: 400 },
          );
        }
        writeBrianFile(edit.file, edit.newContent);
      }
    } catch (err) {
      console.error("Failed to write brian file", err);
      return NextResponse.json(
        { error: "Failed to write one or more files." },
        { status: 500 },
      );
    }

    const appliedEdits = requestedEdits.map((edit) => ({
      file: edit.file ?? "",
      original: allFiles.find((f) => f.relPath === edit.file)?.raw ?? "",
      newContent: edit.newContent ?? "",
      summary: edit.summary ?? "Applied update.",
    }));
    const first = appliedEdits[0];

    return NextResponse.json({
      file: first?.file ?? "",
      original: first?.original ?? "",
      newContent: first?.newContent ?? "",
      summary: summary ?? first?.summary ?? "Applied update.",
      edits: appliedEdits,
    });
  }

  // Build context block — list every file with its full content
  const contextBlock = allFiles
    .map((f) => `### File: ${f.relPath}\n\n${f.raw}`)
    .join("\n\n---\n\n");

  const userMessage = `Here are all the current files in the brian/ knowledge base:\n\n${contextBlock}\n\n---\n\nUser instruction: "${instruction}"\n\nReturn a JSON object with complete updated file content for every relevant file.`;

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

  let result: MultiEditResult;
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
    ) as Partial<MultiEditResult & EditResult>;

    const parsedEdits =
      Array.isArray(parsed.edits) && parsed.edits.length > 0
        ? parsed.edits
        : parsed.file && parsed.newContent
          ? [
              {
                file: parsed.file,
                newContent: parsed.newContent,
                summary: parsed.summary ?? "Updated file.",
              },
            ]
          : [];

    if (
      parsedEdits.length === 0 ||
      parsedEdits.some((edit) => !edit.file || !edit.newContent || !edit.summary)
    ) {
      throw new Error("LLM returned incomplete JSON");
    }

    result = {
      edits: parsedEdits.map((edit) => ({
        file: edit.file ?? "",
        original: allFiles.find((f) => f.relPath === edit.file)?.raw ?? "",
        newContent: edit.newContent ?? "",
        summary: edit.summary ?? "Updated file.",
      })),
      summary:
        parsed.summary ??
        (parsedEdits.length === 1
          ? parsedEdits[0]?.summary ?? "Updated file."
          : `Updated ${parsedEdits.length} files.`),
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
      for (const edit of result.edits) {
        writeBrianFile(edit.file, edit.newContent);
      }
    } catch (err) {
      console.error("Failed to write brian file", err);
      return NextResponse.json(
        { error: "Generated edits but failed to write one or more files." },
        { status: 500 },
      );
    }
  }

  const first = result.edits[0];
  return NextResponse.json({
    file: first?.file ?? "",
    original: first?.original ?? "",
    newContent: first?.newContent ?? "",
    summary: result.summary,
    edits: result.edits,
  });
}
