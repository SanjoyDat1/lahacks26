import {
  Bot,
  Brain,
  CheckCircle2,
  Circle,
  GitBranch,
  MessageSquare,
  Radio,
  Sparkles,
  Video,
  Webhook,
  Zap,
} from "lucide-react";

import { listBrainUpdates, listEvents } from "@/lib/db/store";
import type { StoredEvent } from "@/lib/types";

export default async function EventsPage() {
  const [events, updates] = await Promise.all([listEvents(100), listBrainUpdates(50)]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100">
            <Radio size={15} className="text-sky-600" />
          </div>
          <span className="text-sm font-semibold text-sky-700">Event Stream</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          The AI&apos;s audit trail
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-slate-500">
          Every event your team generates — and what the AI decided to do with it. Nothing is a black box here.
        </p>
        {/* Legend */}
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/80 bg-white/60 px-5 py-3 text-xs backdrop-blur-xl shadow-sm">
          <span className="font-medium text-slate-500">Reading the timeline:</span>
          <LegendItem color="bg-sky-400" label="Event received" />
          <LegendItem color="bg-violet-400" label="AI analyzed" />
          <LegendItem color="bg-emerald-400" label="Brian updated" />
          <LegendItem color="bg-slate-300" label="Skipped (low signal)" />
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[17px] top-0 bottom-0 w-px bg-gradient-to-b from-slate-300/80 via-slate-200/60 to-transparent" />

          <div className="space-y-0">
            {events.map((event, idx) => {
              const update = updates.find((u) => u.eventId === event.id);
              const isLast = idx === events.length - 1;
              return (
                <EventTimelineItem
                  key={event.id}
                  event={event}
                  update={update ?? null}
                  isLast={isLast}
                />
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

// ── Timeline item ──────────────────────────────────────────────────────────────

function EventTimelineItem({
  event,
  update,
  isLast,
}: {
  event: StoredEvent;
  update: { id: string; status: string; rationale: string; diffSummary?: string; changedFiles?: string[] } | null;
  isLast: boolean;
}) {
  const distilled = !!update;
  const processed = event.status === "processed" || distilled;

  return (
    <div className={`relative flex gap-5 pb-6 ${isLast ? "pb-0" : ""}`}>
      {/* Timeline dot */}
      <div className="relative z-10 flex flex-shrink-0 flex-col items-center">
        <div
          className={`
            flex h-9 w-9 items-center justify-center rounded-full border-2 border-white shadow-sm
            ${distilled ? "bg-emerald-500" : processed ? "bg-violet-500" : "bg-slate-300"}
          `}
        >
          {distilled ? (
            <Brain size={14} className="text-white" />
          ) : processed ? (
            <CheckCircle2 size={14} className="text-white" />
          ) : (
            <Circle size={14} className="text-white" />
          )}
        </div>
      </div>

      {/* Content card */}
      <div className="min-w-0 flex-1 pb-2">
        <div className="rounded-2xl border border-white/80 bg-white/65 shadow-sm backdrop-blur-xl overflow-hidden">

          {/* Card header */}
          <div className="flex flex-wrap items-start gap-3 px-5 pt-4 pb-3">
            <SourceBadge source={event.source} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-800">{event.title}</h2>
                {event.significance && <SigPill sig={event.significance} />}
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500 line-clamp-3">{event.body}</p>
            </div>
            <time className="flex-shrink-0 text-[10px] text-slate-400">
              {new Date(event.createdAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>

          {/* Journey bar — shows the event's path through the system */}
          <div className="border-t border-slate-100/80 bg-slate-50/60 px-5 py-2.5">
            <div className="flex items-center gap-0">
              <JourneyStep
                done
                label="Received"
                Icon={Radio}
                color="text-sky-600"
              />
              <JourneyArrow />
              <JourneyStep
                done={processed}
                label="AI read it"
                Icon={Sparkles}
                color="text-violet-600"
              />
              <JourneyArrow />
              <JourneyStep
                done={distilled}
                label="Brian updated"
                Icon={Brain}
                color="text-emerald-600"
              />
              {!distilled && !processed && (
                <>
                  <JourneyArrow />
                  <span className="text-[10px] text-slate-400 italic">filtered out</span>
                </>
              )}
            </div>
          </div>

          {/* Brain update detail */}
          {update && (
            <div className="border-t border-violet-200/50 bg-violet-50/70 px-5 py-3">
              <div className="flex items-start gap-2">
                <Bot size={13} className="mt-0.5 flex-shrink-0 text-violet-500" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-500 mb-1">
                    What the AI added to Brian
                  </p>
                  <p className="text-xs leading-5 text-violet-800">{update.diffSummary ?? update.rationale}</p>
                  {update.changedFiles && update.changedFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {update.changedFiles.map((f) => (
                        <span key={f} className="rounded-full border border-violet-200/60 bg-white/80 px-2 py-0.5 font-mono text-[9px] text-violet-600">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100/60 px-5 py-2">
            <Tag>{event.eventType}</Tag>
            <Tag variant={event.status === "processed" ? "green" : "default"}>{event.status}</Tag>
            {event.actor && <Tag>by {event.actor}</Tag>}
            {event.repository && <Tag>📦 {event.repository}</Tag>}
            {event.channel && <Tag>#{event.channel}</Tag>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small components ───────────────────────────────────────────────────────────

const SOURCE_MAP: Record<string, { bg: string; text: string; label: string; Icon: typeof Radio }> = {
  github:   { bg: "bg-slate-800",   text: "text-white",     label: "GitHub",   Icon: GitBranch },
  gitlab:   { bg: "bg-orange-500",  text: "text-white",     label: "GitLab",   Icon: GitBranch },
  slack:    { bg: "bg-emerald-500", text: "text-white",     label: "Slack",    Icon: MessageSquare },
  discord:  { bg: "bg-indigo-500",  text: "text-white",     label: "Discord",  Icon: MessageSquare },
  meetings: { bg: "bg-blue-500",    text: "text-white",     label: "Meeting",  Icon: Video },
  custom:   { bg: "bg-slate-200",   text: "text-slate-700", label: "Custom",   Icon: Webhook },
};

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE_MAP[source] ?? SOURCE_MAP.custom;
  return (
    <div className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ${s.bg} ${s.text}`}>
      <s.Icon size={11} />
      <span className="text-[11px] font-semibold">{s.label}</span>
    </div>
  );
}

function SigPill({ sig }: { sig: string }) {
  const styles: Record<string, string> = {
    high:     "border-red-200/60 bg-red-50 text-red-700",
    medium:   "border-amber-200/60 bg-amber-50 text-amber-700",
    low:      "border-slate-200/60 bg-slate-50 text-slate-500",
    critical: "border-red-300/60 bg-red-100 text-red-800 font-bold",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold capitalize ${styles[sig] ?? styles.low}`}>
      ⚡ {sig} signal
    </span>
  );
}

function JourneyStep({ done, label, Icon, color }: { done: boolean; label: string; Icon: typeof Radio; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <Icon size={11} className={done ? color : "text-slate-300"} />
      <span className={`text-[10px] font-medium ${done ? "text-slate-600" : "text-slate-300"}`}>{label}</span>
    </div>
  );
}

function JourneyArrow() {
  return <span className="mx-2 text-[10px] text-slate-300">→</span>;
}

function Tag({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "green" | "violet";
}) {
  const styles = {
    default: "border-slate-200/60 bg-slate-100/80 text-slate-500",
    green:   "border-emerald-200/60 bg-emerald-50/80 text-emerald-700",
    violet:  "border-violet-200/60 bg-violet-50/80 text-violet-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-slate-500">{label}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-5 rounded-3xl border border-white/80 bg-white/60 p-16 text-center shadow-sm backdrop-blur-2xl">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50 ring-1 ring-sky-200/60">
        <Radio size={28} className="text-sky-400" />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-700">No events captured yet</p>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
          Once your sources are connected (GitHub, Slack, Discord) or you seed demo data, events will appear here with their full AI-processing trail.
        </p>
      </div>
      <form action="/api/demo" method="post">
        <button className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700">
          <Zap size={14} />
          Seed demo events
        </button>
      </form>
    </div>
  );
}
