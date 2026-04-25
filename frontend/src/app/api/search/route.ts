import { NextRequest, NextResponse } from "next/server";

import { searchDocuments } from "@/lib/db/store";
import { embedText } from "@/lib/llm/client";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }

  const embedding = await embedText(query);
  const results = await searchDocuments(query, embedding);
  return NextResponse.json({
    results: results.map((result) => ({
      score: result.score,
      document: {
        id: result.document.id,
        eventId: result.document.eventId,
        source: result.document.source,
        text: result.document.text,
        sourceUrl: result.document.sourceUrl,
        createdAt: result.document.createdAt,
      },
    })),
  });
}
