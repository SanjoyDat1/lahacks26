import { z } from "zod";

import type { NormalizedEvent, SourceType } from "@/lib/types";
import { stableId, truncate } from "@/lib/utils";

const sourceSchema = z.enum(["github", "gitlab", "slack", "discord", "meetings", "manual"]);

export function parseSource(input: string): SourceType | undefined {
  const parsed = sourceSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export function normalizeEvent(source: SourceType, payload: unknown): NormalizedEvent {
  if (source === "github") return normalizeGitHub(payload);
  if (source === "gitlab") return normalizeGitLab(payload);
  if (source === "slack") return normalizeSlack(payload);
  if (source === "discord") return normalizeDiscord(payload);
  if (source === "meetings") return normalizeMeeting(payload);
  return normalizeManual(payload);
}

function normalizeGitHub(payload: unknown): NormalizedEvent {
  const data = asRecord(payload);
  const action = String(data.action ?? "unknown");
  const issue = asOptionalRecord(data.issue);
  const pull = asOptionalRecord(data.pull_request);
  const comment = asOptionalRecord(data.comment);
  const target = pull ?? issue ?? {};
  const repo = asOptionalRecord(data.repository);
  const title = comment?.body
    ? `${text(repo?.full_name, "GitHub")}: ${truncate(text(comment.body), 80)}`
    : `${text(repo?.full_name, "GitHub")}: ${text(target.title, action)}`;

  return {
    source: "github",
    sourceEventId: String(data.delivery ?? comment?.id ?? pull?.id ?? issue?.id ?? stableId("github")),
    sourceUrl: text(comment?.html_url ?? pull?.html_url ?? issue?.html_url) || undefined,
    actor: asOptionalRecord(data.sender)?.login?.toString(),
    title,
    body: [target.title, pull?.body ?? issue?.body, comment?.body].filter(Boolean).map((value) => text(value)).join("\n\n"),
    repository: text(repo?.full_name) || undefined,
    eventType: `github.${action}`,
    payload,
  };
}

function normalizeGitLab(payload: unknown): NormalizedEvent {
  const data = asRecord(payload);
  const object = asOptionalRecord(data.object_attributes);
  const project = asOptionalRecord(data.project);

  return {
    source: "gitlab",
    sourceEventId: String(object?.id ?? object?.iid ?? stableId("gitlab")),
    sourceUrl: text(object?.url) || undefined,
    actor: asOptionalRecord(data.user)?.username?.toString() ?? asOptionalRecord(data.user)?.name?.toString(),
    title: `${text(project?.path_with_namespace, "GitLab")}: ${text(object?.title ?? object?.note ?? data.object_kind, "event")}`,
    body: [object?.title, object?.description, object?.note].filter(Boolean).map((value) => text(value)).join("\n\n"),
    repository: text(project?.path_with_namespace) || undefined,
    eventType: `gitlab.${data.object_kind ?? "event"}`,
    payload,
  };
}

function normalizeSlack(payload: unknown): NormalizedEvent {
  const data = asRecord(payload);
  const event = asOptionalRecord(data.event) ?? data;

  return {
    source: "slack",
    sourceEventId: String(event.client_msg_id ?? event.ts ?? data.event_id ?? stableId("slack")),
    actor: text(event.user ?? data.user_id) || undefined,
    title: `Slack ${text(event.channel, "channel")}: ${truncate(text(event.text, "message"), 100)}`,
    body: String(event.text ?? data.text ?? ""),
    channel: text(event.channel ?? data.channel_id) || undefined,
    eventType: `slack.${event.type ?? data.type ?? "event"}`,
    payload,
  };
}

function normalizeDiscord(payload: unknown): NormalizedEvent {
  const data = asRecord(payload);
  const message = asOptionalRecord(data.message) ?? data;

  return {
    source: "discord",
    sourceEventId: String(message.id ?? data.id ?? stableId("discord")),
    actor:
      asOptionalRecord(message.author)?.username?.toString() ??
      asOptionalRecord(data.author)?.username?.toString() ??
      asOptionalRecord(asOptionalRecord(data.member)?.user)?.username?.toString(),
    title: `Discord ${text(message.channel_id ?? data.channel_id, "channel")}: ${truncate(text(message.content ?? data.content, "event"), 100)}`,
    body: String(message.content ?? data.content ?? ""),
    channel: text(message.channel_id ?? data.channel_id) || undefined,
    eventType: `discord.${data.type ?? "message"}`,
    payload,
  };
}

function normalizeMeeting(payload: unknown): NormalizedEvent {
  const data = asRecord(payload);
  const transcript = data.transcript ?? data.text ?? data.summary ?? "";

  return {
    source: "meetings",
    sourceEventId: String(data.id ?? data.transcript_id ?? stableId("meeting")),
    sourceUrl: text(data.audio_url ?? data.url) || undefined,
    actor: text(data.organizer ?? data.created_by) || undefined,
    title: String(data.title ?? data.meeting_title ?? "Meeting transcript"),
    body: String(transcript),
    eventType: `meetings.${data.status ?? "transcript"}`,
    payload,
  };
}

function normalizeManual(payload: unknown): NormalizedEvent {
  const data = asRecord(payload);

  return {
    source: "manual",
    sourceEventId: String(data.id ?? stableId("manual")),
    actor: text(data.actor, "demo"),
    title: String(data.title ?? "Manual event"),
    body: String(data.body ?? data.text ?? ""),
    eventType: "manual.note",
    payload,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown, fallback = "") {
  return value == null ? fallback : String(value);
}
