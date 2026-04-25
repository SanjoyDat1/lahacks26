import { desc, eq, ilike, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { brainUpdates, documents, events, integrations } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type {
  BrainUpdate,
  NormalizedEvent,
  SearchResult,
  SourceType,
  StoredDocument,
  StoredEvent,
} from "@/lib/types";
import { cosineSimilarity, stableId } from "@/lib/utils";

const memory = {
  events: [] as StoredEvent[],
  documents: [] as StoredDocument[],
  brainUpdates: [] as BrainUpdate[],
};

export async function createEvent(input: NormalizedEvent) {
  const db = getDb();

  if (!db) {
    const event: StoredEvent = {
      ...input,
      id: stableId("event"),
      status: "received",
      createdAt: new Date(),
      receivedAt: input.receivedAt ?? new Date(),
    };
    memory.events.unshift(event);
    return event;
  }

  const [event] = await db
    .insert(events)
    .values({
      source: input.source,
      sourceEventId: input.sourceEventId,
      sourceUrl: input.sourceUrl,
      actor: input.actor,
      title: input.title,
      body: input.body,
      repository: input.repository,
      channel: input.channel,
      eventType: input.eventType,
      payload: input.payload,
      receivedAt: input.receivedAt,
    })
    .returning();

  return mapEvent(event);
}

export async function updateEventStatus(
  id: string,
  patch: Pick<StoredEvent, "status"> & Partial<Pick<StoredEvent, "significance" | "distillerSummary">>,
) {
  const db = getDb();

  if (!db) {
    const event = memory.events.find((item) => item.id === id);
    if (event) Object.assign(event, patch);
    return;
  }

  await db
    .update(events)
    .set({
      status: patch.status,
      significance: patch.significance,
      distillerSummary: patch.distillerSummary,
    })
    .where(eq(events.id, id));
}

export async function listEvents(limit = 50) {
  const db = getDb();

  if (!db) return memory.events.slice(0, limit);

  const rows = await db.select().from(events).orderBy(desc(events.createdAt)).limit(limit);
  return rows.map(mapEvent);
}

export async function createDocument(input: {
  eventId: string;
  source: SourceType;
  text: string;
  sourceUrl?: string;
  embedding?: number[];
}) {
  const db = getDb();

  if (!db) {
    const document: StoredDocument = {
      id: stableId("doc"),
      eventId: input.eventId,
      source: input.source,
      text: input.text,
      sourceUrl: input.sourceUrl,
      embedding: input.embedding,
      createdAt: new Date(),
    };
    memory.documents.unshift(document);
    return document;
  }

  const [document] = await db
    .insert(documents)
    .values({
      eventId: input.eventId,
      source: input.source,
      text: input.text,
      sourceUrl: input.sourceUrl,
      embedding: input.embedding,
    })
    .returning();

  return mapDocument(document);
}

export async function createBrainUpdate(input: Omit<BrainUpdate, "id" | "createdAt">) {
  const db = getDb();

  if (!db) {
    const update: BrainUpdate = {
      ...input,
      id: stableId("brain"),
      createdAt: new Date(),
    };
    memory.brainUpdates.unshift(update);
    return update;
  }

  const [update] = await db
    .insert(brainUpdates)
    .values(input)
    .returning();

  return {
    ...update,
    commitSha: update.commitSha ?? undefined,
    changedFiles: update.changedFiles,
    status: update.status as BrainUpdate["status"],
  } satisfies BrainUpdate;
}

export async function listBrainUpdates(limit = 20) {
  const db = getDb();

  if (!db) return memory.brainUpdates.slice(0, limit);

  const rows = await db.select().from(brainUpdates).orderBy(desc(brainUpdates.createdAt)).limit(limit);
  return rows.map((row) => ({
    ...row,
    commitSha: row.commitSha ?? undefined,
    status: row.status as BrainUpdate["status"],
    changedFiles: row.changedFiles,
  }));
}

export async function searchDocuments(query: string, embedding?: number[], limit = 8) {
  const db = getDb();

  if (!db) {
    const normalized = query.toLowerCase();
    const results = memory.documents
      .map((document) => ({
        document,
        score: embedding && document.embedding ? cosineSimilarity(embedding, document.embedding) : keywordScore(document.text, normalized),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  if (embedding?.length) {
    const vector = `[${embedding.join(",")}]`;
    const rows = await db
      .select({
        document: documents,
        score: sql<number>`1 - (${documents.embedding} <=> ${vector}::vector)`,
      })
      .from(documents)
      .orderBy(sql`${documents.embedding} <=> ${vector}::vector`)
      .limit(limit);

    return rows.map(({ document, score }) => ({
      document: mapDocument(document),
      score: Number(score),
    })) satisfies SearchResult[];
  }

  const rows = await db
    .select()
    .from(documents)
    .where(ilike(documents.text, `%${query}%`))
    .limit(limit);

  return rows.map((document) => ({
    document: mapDocument(document),
    score: keywordScore(document.text, query.toLowerCase()),
  }));
}

export async function listIntegrations() {
  const sources: SourceType[] = ["github", "gitlab", "slack", "discord", "meetings"];
  const db = getDb();

  if (!db) {
    return sources.map((source) => ({
      source,
      displayName: sourceLabel(source),
      status: "ready",
      webhookUrl: `${env.appUrl}/api/ingest/${source}`,
      lastEventAt: memory.events.find((event) => event.source === source)?.createdAt,
    }));
  }

  const rows = await db.select().from(integrations);
  return sources.map((source) => {
    const existing = rows.find((row) => row.source === source);
    return {
      source,
      displayName: sourceLabel(source),
      status: existing?.status ?? "not_configured",
      webhookUrl: `${env.appUrl}/api/ingest/${source}`,
      lastEventAt: existing?.lastEventAt,
    };
  });
}

function sourceLabel(source: SourceType) {
  const labels: Record<SourceType, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    slack: "Slack",
    discord: "Discord",
    meetings: "Meetings",
    manual: "Manual",
  };
  return labels[source];
}

function keywordScore(text: string, query: string) {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) / Math.max(terms.length, 1);
}

function mapEvent(row: typeof events.$inferSelect): StoredEvent {
  return {
    id: row.id,
    source: row.source as SourceType,
    sourceEventId: row.sourceEventId,
    sourceUrl: row.sourceUrl ?? undefined,
    actor: row.actor ?? undefined,
    title: row.title,
    body: row.body,
    repository: row.repository ?? undefined,
    channel: row.channel ?? undefined,
    eventType: row.eventType,
    payload: row.payload,
    status: row.status as StoredEvent["status"],
    significance: row.significance as StoredEvent["significance"],
    distillerSummary: row.distillerSummary ?? undefined,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
  };
}

function mapDocument(row: typeof documents.$inferSelect): StoredDocument {
  return {
    id: row.id,
    eventId: row.eventId,
    source: row.source as SourceType,
    text: row.text,
    sourceUrl: row.sourceUrl ?? undefined,
    embedding: row.embedding ?? undefined,
    createdAt: row.createdAt,
  };
}
