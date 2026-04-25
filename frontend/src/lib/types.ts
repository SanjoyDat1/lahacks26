export type SourceType =
  | "github"
  | "gitlab"
  | "slack"
  | "discord"
  | "meetings"
  | "manual";

export type EventStatus = "received" | "processed" | "ignored" | "failed";

export type BrainUpdateStatus = "proposed" | "applied" | "failed";

export type BrainFile = {
  path: string;
  content: string;
  sha?: string;
};

export type NormalizedEvent = {
  id?: string;
  source: SourceType;
  sourceEventId: string;
  sourceUrl?: string;
  actor?: string;
  title: string;
  body: string;
  repository?: string;
  channel?: string;
  eventType: string;
  payload: unknown;
  receivedAt?: Date;
};

export type StoredEvent = NormalizedEvent & {
  id: string;
  status: EventStatus;
  significance?: "high" | "medium" | "low" | "none";
  distillerSummary?: string;
  createdAt: Date;
};

export type StoredDocument = {
  id: string;
  eventId: string;
  source: SourceType;
  text: string;
  sourceUrl?: string;
  embedding?: number[];
  createdAt: Date;
};

export type BrainUpdate = {
  id: string;
  eventId: string;
  status: BrainUpdateStatus;
  rationale: string;
  changedFiles: string[];
  commitSha?: string;
  diffSummary: string;
  createdAt: Date;
};

export type SearchResult = {
  document: StoredDocument;
  score: number;
};
