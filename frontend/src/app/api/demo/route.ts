import { NextResponse } from "next/server";

import { ingestPayload } from "@/lib/ingest/service";

export async function POST() {
  const samples = [
    {
      id: "demo-github-1",
      title: "Adopt Git-backed Brian as the source of truth",
      body: "Architecture decision: before any coding agent writes code, it must read /brain and append durable design decisions to brain/decision_log.md.",
      actor: "founder",
    },
    {
      id: "demo-meeting-1",
      title: "Launch readiness meeting",
      text: "We decided the first launch needs real GitHub, GitLab, Slack, Discord, and meeting transcript ingestion endpoints. Postgres with pgvector is the production vector database.",
      organizer: "team",
    },
  ];

  const results = [];
  results.push(await ingestPayload("manual", samples[0]));
  results.push(await ingestPayload("meetings", samples[1]));

  return NextResponse.json({ ok: true, results });
}
