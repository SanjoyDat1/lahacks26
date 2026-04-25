import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    sourceUrl: text("source_url"),
    actor: text("actor"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    repository: text("repository"),
    channel: text("channel"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("received"),
    significance: text("significance"),
    distillerSummary: text("distiller_summary"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("events_source_idx").on(table.source),
    index("events_status_idx").on(table.status),
    index("events_received_at_idx").on(table.receivedAt),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    source: text("source").notNull(),
    text: text("text").notNull(),
    sourceUrl: text("source_url"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("documents_source_idx").on(table.source),
    index("documents_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull().unique(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("not_configured"),
  webhookUrl: text("webhook_url"),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const brainUpdates = pgTable(
  "brain_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .references(() => events.id, { onDelete: "cascade" })
      .notNull(),
    status: text("status").notNull(),
    rationale: text("rationale").notNull(),
    changedFiles: jsonb("changed_files").$type<string[]>().notNull(),
    commitSha: text("commit_sha"),
    diffSummary: text("diff_summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("brain_updates_status_idx").on(table.status)],
);
