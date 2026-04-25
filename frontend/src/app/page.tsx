import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  GitBranch,
  MessageSquare,
  Radio,
  Search,
  Sparkles,
  Video,
  Webhook,
  Zap,
} from "lucide-react";

import { listBrainUpdates, listEvents, listIntegrations } from "@/lib/db/store";

export default async function Home() {
  const [events, updates, integrations] = await Promise.all([
    listEvents(8),
    listBrainUpdates(8),
    listIntegrations(),
  ]);

  const recentActivity = events.slice(0, 5).map((e) => ({
    event: e,
    update: updates.find((u) => u.eventId === e.id) ?? null,
  }));

  const activeIntegrations = integrations.filter((i) => i.status === "active");

  return (
    <main className="mx-auto max-w-screen-xl px-6">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="pt-16 pb-12">
        <div className="flex max-w-4xl flex-col gap-6">
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-violet-200/60 bg-violet-50/80 px-3.5 py-1.5 text-xs font-medium text-violet-700">
            <Sparkles size={11} className="text-violet-500" />
            Bridging humans and AI agents
          </div>

          <h1 className="text-5xl font-bold tracking-tight text-slate-900 md:text-6xl leading-[1.08]">
            What your AI agent knows
            <br />
            <span className="text-violet-600">should be visible to you.</span>
          </h1>

          <p className="max-w-2xl text-xl leading-8 text-slate-500">
            Capture every decision from GitHub, Slack, and meetings. Let AI distill what matters. Store it in a brain your agents can read — and your team can inspect, edit, and understand.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/brain"
              className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-300/40 transition-all hover:bg-violet-700 hover:shadow-violet-400/50"
            >
              <Brain size={16} />
              Explore the Brain
              <ArrowRight size={15} />
            </Link>
            <Link
              href="/agent"
              className="inline-flex items-center gap-2 rounded-full border border-violet-300/60 bg-violet-50/80 px-6 py-3 text-sm font-semibold text-violet-700 backdrop-blur-sm transition-all hover:bg-violet-100/80"
            >
              <Cpu size={14} className="text-violet-500" />
              Watch Agent Live
            </Link>
            <form action="/api/demo" method="post">
              <button className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-6 py-3 text-sm font-medium text-slate-700 backdrop-blur-sm transition-all hover:bg-white hover:border-slate-300">
                <Zap size={14} className="text-amber-500" />
                Seed demo data
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ── Pipeline (the full story in 5 steps) ─────────────────────────── */}
      <section className="pb-14">
        <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
          How it works — the full journey
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {PIPELINE.map(({ label, desc, Icon, iconBg, iconColor, step }, i) => (
            <div key={label} className="relative">
              {/* Connector arrow */}
              {i < PIPELINE.length - 1 && (
                <ChevronRight
                  size={14}
                  className="absolute -right-1.5 top-5 z-10 hidden text-slate-300 md:block"
                />
              )}
              <div className="flex flex-col gap-3 rounded-2xl border border-white/80 bg-white/60 p-4 shadow-sm backdrop-blur-xl transition-all hover:bg-white/80 hover:shadow-md h-full">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-slate-400">{step}</span>
                  <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${iconBg}`}>
                    <Icon size={14} className={iconColor} />
                  </div>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">{label}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stats + quick actions ─────────────────────────────────────────── */}
      <section className="grid gap-4 pb-10 md:grid-cols-3">
        <StatCard
          value={events.length}
          label="Events captured"
          sublabel="Webhooks received and normalized"
          href="/events"
          Icon={Radio}
          color="sky"
        />
        <StatCard
          value={updates.length}
          label="Brain updates"
          sublabel="AI-distilled decisions stored"
          href="/brain"
          Icon={Brain}
          color="violet"
        />
        <StatCard
          value={activeIntegrations.length}
          label="Sources connected"
          sublabel={`of ${integrations.length} total integrations`}
          Icon={Webhook}
          color="emerald"
        />
      </section>

      {/* ── Bottom grid: activity feed + transparency panel ──────────────── */}
      <section className="grid gap-6 pb-16 lg:grid-cols-[1fr_380px]">

        {/* Left: Recent AI Activity */}
        <div className="rounded-3xl border border-white/80 bg-white/60 shadow-sm backdrop-blur-2xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200/50 px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Recent AI Activity</h2>
              <p className="mt-0.5 text-xs text-slate-400">Every event your AI saw and what it decided</p>
            </div>
            <Link
              href="/events"
              className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>

          {recentActivity.length ? (
            <div className="divide-y divide-slate-100/70">
              {recentActivity.map(({ event, update }) => (
                <div key={event.id} className="px-6 py-4 transition-colors hover:bg-white/50">
                  <div className="flex items-start gap-3">
                    <SourceIcon source={event.source} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-800 truncate">{event.title}</p>
                        {event.significance && (
                          <SignificancePill sig={event.significance} />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{event.body}</p>

                      {/* Journey indicator */}
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span className="capitalize">{event.source}</span>
                        <span>→</span>
                        <span className={event.status === "processed" ? "text-emerald-600 font-medium" : ""}>
                          {event.status}
                        </span>
                        {update && (
                          <>
                            <span>→</span>
                            <span className="text-violet-600 font-medium">Brain updated</span>
                          </>
                        )}
                      </div>

                      {update && (
                        <div className="mt-2 flex items-start gap-1.5 rounded-xl border border-violet-200/50 bg-violet-50/80 px-3 py-2">
                          <Brain size={10} className="mt-0.5 flex-shrink-0 text-violet-500" />
                          <p className="text-[11px] text-violet-700">{update.diffSummary}</p>
                        </div>
                      )}
                    </div>
                    <time className="flex-shrink-0 text-[10px] text-slate-400">
                      {relativeTime(new Date(event.createdAt))}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyActivity />
          )}
        </div>

        {/* Right: Transparency panel + Source setup */}
        <div className="space-y-4">

          {/* What the AI can see right now */}
          <div className="rounded-3xl border border-white/80 bg-white/60 p-6 shadow-sm backdrop-blur-2xl">
            <h3 className="text-sm font-semibold text-slate-800">What agents can see right now</h3>
            <p className="mt-1 text-xs text-slate-400">Inspect the brain your AI reads before writing any code</p>
            <Link
              href="/brain"
              className="mt-4 flex items-center gap-3 rounded-2xl border border-violet-200/60 bg-violet-50/80 p-3.5 transition-all hover:bg-violet-100/80 group"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200/60">
                <Brain size={16} className="text-violet-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-violet-700">Open Brain Workspace</p>
                <p className="text-[11px] text-violet-500">Graph · Editor · Agent Sim · Chat</p>
              </div>
              <ArrowRight size={14} className="flex-shrink-0 text-violet-400 transition-transform group-hover:translate-x-0.5" />
            </Link>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { href: "/agent",  label: "Agent live",   Icon: Bot,     desc: "Real-time trace" },
                { href: "/events", label: "Event log",    Icon: Radio,   desc: "What came in" },
                { href: "/search", label: "Search memory", Icon: Search,  desc: "Query the brain" },
              ].map(({ href, label, Icon, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col gap-1.5 rounded-xl border border-slate-200/60 bg-white/70 p-3 transition-all hover:bg-white/90 group"
                >
                  <Icon size={14} className="text-slate-400 group-hover:text-violet-500 transition-colors" />
                  <p className="text-xs font-medium text-slate-700">{label}</p>
                  <p className="text-[10px] text-slate-400">{desc}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Connect sources */}
          <div className="rounded-3xl border border-white/80 bg-white/60 p-6 shadow-sm backdrop-blur-2xl">
            <h3 className="text-sm font-semibold text-slate-800">Connect your sources</h3>
            <p className="mt-1 text-xs text-slate-400">Point these webhooks at your tools to start capturing context</p>
            <div className="mt-4 space-y-2">
              {integrations.slice(0, 4).map((ig) => (
                <div key={ig.source} className="flex items-center gap-2 rounded-xl border border-slate-200/50 bg-white/70 px-3 py-2">
                  <SourceIcon source={ig.source} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-slate-600">{ig.displayName}</p>
                    <p className="truncate font-mono text-[9px] text-slate-400">{ig.webhookUrl}</p>
                  </div>
                  <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${ig.status === "active" ? "bg-emerald-400" : "bg-slate-300"}`} />
                </div>
              ))}
            </div>
            {integrations.length > 4 && (
              <p className="mt-2 text-center text-[10px] text-slate-400">
                +{integrations.length - 4} more endpoints available
              </p>
            )}
          </div>

        </div>
      </section>
    </main>
  );
}

// ── Pipeline steps ─────────────────────────────────────────────────────────────

const PIPELINE = [
  {
    step: "01",
    label: "Your team works",
    desc: "PRs, Slack messages, meetings, and decisions happen constantly",
    Icon: MessageSquare,
    iconBg: "bg-sky-100",
    iconColor: "text-sky-600",
  },
  {
    step: "02",
    label: "We capture it",
    desc: "Webhooks normalize every event into one consistent shape",
    Icon: Radio,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
  },
  {
    step: "03",
    label: "AI distills",
    desc: "An LLM reads each event and extracts what's durable and important",
    Icon: Sparkles,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
  },
  {
    step: "04",
    label: "Brain stores it",
    desc: "Decisions become Markdown files. Every change is a Git commit.",
    Icon: Database,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
  },
  {
    step: "05",
    label: "Agents read it",
    desc: "Your coding agent reads the brain before touching any code",
    Icon: Bot,
    iconBg: "bg-pink-100",
    iconColor: "text-pink-600",
  },
];

// ── Helper components ──────────────────────────────────────────────────────────

const SOURCE_STYLES: Record<string, { bg: string; text: string; label: string; Icon: typeof Radio }> = {
  github:   { bg: "bg-slate-800",   text: "text-white",         label: "GH",  Icon: GitBranch },
  gitlab:   { bg: "bg-orange-500",  text: "text-white",         label: "GL",  Icon: GitBranch },
  slack:    { bg: "bg-emerald-500", text: "text-white",         label: "SL",  Icon: MessageSquare },
  discord:  { bg: "bg-indigo-500",  text: "text-white",         label: "DC",  Icon: MessageSquare },
  meetings: { bg: "bg-blue-500",    text: "text-white",         label: "MT",  Icon: Video },
  custom:   { bg: "bg-slate-200",   text: "text-slate-600",     label: "CX",  Icon: Webhook },
};

function SourceIcon({ source, size = "md" }: { source: string; size?: "sm" | "md" }) {
  const style = SOURCE_STYLES[source] ?? SOURCE_STYLES.custom;
  const dim = size === "sm" ? "h-6 w-6 text-[8px]" : "h-7 w-7 text-[9px]";
  return (
    <div className={`flex flex-shrink-0 items-center justify-center rounded-lg font-bold ${dim} ${style.bg} ${style.text}`}>
      {style.label}
    </div>
  );
}

function SignificancePill({ sig }: { sig: string }) {
  const styles: Record<string, string> = {
    high:     "border-red-200/60 bg-red-50 text-red-700",
    medium:   "border-amber-200/60 bg-amber-50 text-amber-700",
    low:      "border-slate-200/60 bg-slate-50 text-slate-500",
    critical: "border-red-300/60 bg-red-100 text-red-800",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold capitalize ${styles[sig] ?? styles.low}`}>
      {sig}
    </span>
  );
}

function StatCard({
  value, label, sublabel, href, Icon, color,
}: {
  value: number;
  label: string;
  sublabel: string;
  href?: string;
  Icon: typeof Radio;
  color: "sky" | "violet" | "emerald";
}) {
  const colors = {
    sky:     { bg: "bg-sky-100",     icon: "text-sky-600",     num: "text-sky-700" },
    violet:  { bg: "bg-violet-100",  icon: "text-violet-600",  num: "text-violet-700" },
    emerald: { bg: "bg-emerald-100", icon: "text-emerald-600", num: "text-emerald-700" },
  };
  const c = colors[color];
  const inner = (
    <div className="flex items-center gap-4 rounded-3xl border border-white/80 bg-white/65 p-6 shadow-sm backdrop-blur-2xl transition-all hover:bg-white/80 hover:shadow-md">
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${c.bg}`}>
        <Icon size={22} className={c.icon} />
      </div>
      <div>
        <p className={`text-4xl font-bold tabular-nums ${c.num}`}>{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-400">{sublabel}</p>
      </div>
      {href && <ChevronRight size={16} className="ml-auto text-slate-300" />}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

function EmptyActivity() {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-14 text-center">
      <div className="relative">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 ring-1 ring-violet-200/60">
          <Brain size={28} className="text-violet-400" />
        </div>
        <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] text-white font-bold">
          0
        </div>
      </div>
      <div className="max-w-xs">
        <p className="text-sm font-semibold text-slate-700">No activity yet</p>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          Seed demo data to see how events flow from sources → AI distillation → brain updates. Or connect a real source via the webhooks below.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        <form action="/api/demo" method="post">
          <button className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-violet-700">
            <Zap size={12} />
            Seed demo events
          </button>
        </form>
        <Link
          href="/brain"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-white/80 px-4 py-2 text-xs font-medium text-slate-600 transition hover:bg-white"
        >
          <Brain size={12} />
          View the brain
        </Link>
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/50 bg-slate-50/80 p-4 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Getting started</p>
        {[
          { n: 1, text: "Add OPENAI_API_KEY to .env for AI distillation" },
          { n: 2, text: "Seed demo data or post to /api/ingest/github" },
          { n: 3, text: "Watch events appear and the brain update" },
        ].map(({ n, text }) => (
          <div key={n} className="flex items-start gap-2.5 py-1.5">
            <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-600 mt-0.5">
              {n}
            </span>
            <p className="text-[11px] leading-4 text-slate-500">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function relativeTime(date: Date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
