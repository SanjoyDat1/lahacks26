import OpenAI from "openai";

import { env } from "@/lib/env";

let openai: OpenAI | undefined;

function getOpenAI() {
  if (!env.openaiApiKey) return undefined;
  openai ??= new OpenAI({ apiKey: env.openaiApiKey });
  return openai;
}

export async function embedText(text: string) {
  const client = getOpenAI();
  if (!client) return deterministicEmbedding(text);

  const response = await client.embeddings.create({
    model: env.embeddingModel,
    input: text.slice(0, 8000),
  });

  return response.data[0]?.embedding ?? deterministicEmbedding(text);
}

export async function completeJson<T>(prompt: string, fallback: T) {
  const client = getOpenAI();
  if (!client) return fallback;

  try {
    const response = await client.chat.completions.create({
      model: env.openaiModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a precise engineering context librarian. Return only valid JSON matching the user's requested shape.",
        },
        { role: "user", content: prompt },
      ],
    });

    return JSON.parse(response.choices[0]?.message.content ?? "{}") as T;
  } catch (error) {
    console.error("LLM JSON completion failed", error);
    return fallback;
  }
}

function deterministicEmbedding(text: string) {
  const vector = new Array<number>(1536).fill(0);
  for (let index = 0; index < text.length; index += 1) {
    const bucket = text.charCodeAt(index) % vector.length;
    vector[bucket] += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}
