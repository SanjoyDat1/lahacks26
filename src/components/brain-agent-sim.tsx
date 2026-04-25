"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";

import type { BrianFile } from "@/lib/brian/reader";
import {
  getHighlightedNodes,
  SCENARIOS,
  type Relevance,
  type Scenario,
  type FileRead,
} from "@/lib/brian/scenarios";
import { cn } from "@/lib/utils";

// ─── Token estimation (~4 chars/token) ───────────────────────────────────────
function estimateTokens(content: string) {
  return Math.round(content.length / 4);
}
const CONTEXT_WINDOW = 8000;

// ─── Relevance config ─────────────────────────────────────────────────────────
const RELEVANCE: Record<Relevance, { dot: string; badge: string; label: string; border: string; bg: string }> = {
  primary: {
    dot: "bg-violet-600 shadow-[0_0_8px_rgba(139,92,246,0.5)]",
    badge: "border-violet-300/60 bg-violet-100 text-violet-700",
    label: "Primary read",
    border: "border-violet-200/60",
    bg: "bg-violet-50/60",
  },
  secondary: {
    dot: "bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.4)]",
    badge: "border-sky-300/60 bg-sky-100 text-sky-700",
    label: "Supporting context",
    border: "border-sky-200/50",
    bg: "bg-sky-50/40",
  },
  referenced: {
    dot: "bg-slate-400",
    badge: "border-slate-200/60 bg-slate-100 text-slate-500",
    label: "Quick reference",
    border: "border-slate-200/40",
    bg: "bg-white/40",
  },
};

// ─── Scenario color palettes ──────────────────────────────────────────────────
const PALETTE: Record<string, { accent: string; light: string; text: string; ring: string }> = {
  blue:   { accent: "bg-blue-500",   light: "bg-blue-50",   text: "text-blue-700",   ring: "ring-blue-300/50"   },
  red:    { accent: "bg-red-500",    light: "bg-red-50",    text: "text-red-700",    ring: "ring-red-300/50"    },
  green:  { accent: "bg-emerald-500", light: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-300/50" },
  purple: { accent: "bg-violet-600", light: "bg-violet-50", text: "text-violet-700", ring: "ring-violet-300/50" },
  orange: { accent: "bg-orange-500", light: "bg-orange-50", text: "text-orange-700", ring: "ring-orange-300/50" },
  cyan:   { accent: "bg-cyan-500",   light: "bg-cyan-50",   text: "text-cyan-700",   ring: "ring-cyan-300/50"   },
};

interface Props {
  files?: BrianFile[];
  onHighlightChange: (map: Map<string, Relevance> | undefined) => void;
}

export function BrainAgentSim({ files = [], onHighlightChange }: Props) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newFileIds, setNewFileIds] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function findBrianFile(id: string) {
    return files.find((f) => f.frontmatter.id === id);
  }

  useEffect(() => {
    if (!scenario) { onHighlightChange(undefined); return; }
    onHighlightChange(getHighlightedNodes(scenario, step));
  }, [scenario, step, onHighlightChange]);

  useEffect(() => {
    if (!playing || !scenario) return;
    intervalRef.current = setInterval(() => {
      setStep((prev) => {
        const next = prev + 1;
        if (next >= scenario.steps.length) { setPlaying(false); return prev; }
        const ids = new Set(scenario.steps[next].files.map((f) => f.id));
        setNewFileIds(ids);
        setTimeout(() => setNewFileIds(new Set()), 1500);
        return next;
      });
    }, 3200);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, scenario]);

  function startScenario(s: Scenario) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScenario(s); setStep(0); setPlaying(false);
    setExpandedId(null); setNewFileIds(new Set());
  }

  function navigate(delta: number) {
    if (!scenario) return;
    const next = Math.max(0, Math.min(scenario.steps.length - 1, step + delta));
    if (next !== step) {
      const ids = new Set(scenario.steps[next].files.map((f) => f.id));
      setNewFileIds(ids);
      setTimeout(() => setNewFileIds(new Set()), 1500);
    }
    setStep(next);
  }

  function reset() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScenario(null); setStep(0); setPlaying(false);
    setExpandedId(null); setNewFileIds(new Set());
  }

  function togglePlay() {
    if (!scenario) return;
    if (step >= scenario.steps.length - 1) { setStep(0); setNewFileIds(new Set()); }
    setPlaying((p) => !p);
  }

  if (!scenario) {
    return <ScenarioPicker onSelect={startScenario} />;
  }

  const currentStep = scenario.steps[step];
  const palette = PALETTE[scenario.colorClass] ?? PALETTE.blue;
  const isComplete = step === scenario.steps.length - 1;
  const isFirst = step === 0;

  // All files read so far (excluding current step)
  const prevFiles: (FileRead & { stepIdx: number })[] = scenario.steps
    .slice(0, step)
    .flatMap((s, i) => s.files.map((f) => ({ ...f, stepIdx: i })));

  // Token totals
  const allRead = scenario.steps
    .slice(0, step + 1)
    .flatMap((s) => s.files);
  const totalTokens = allRead.reduce((sum, sf) => {
    const bf = findBrianFile(sf.id);
    return sum + (bf ? estimateTokens(bf.content) : 150);
  }, 0);
  const ctxPct = Math.min(100, Math.round((totalTokens / CONTEXT_WINDOW) * 100));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white/40">

      {/* ── Step progress bar ──────────────────────────────────────────── */}
      <div className="border-b border-slate-200/60 bg-white/70 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          {/* Scenario label */}
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="text-lg">{scenario.icon}</span>
            <div className="min-w-0">
              <p className={cn("truncate text-sm font-bold", palette.text)}>{scenario.name}</p>
              <p className="text-[10px] text-slate-400">Step {step + 1} of {scenario.steps.length}</p>
            </div>
          </div>

          {/* Step dots */}
          <div className="flex items-center gap-1">
            {scenario.steps.map((_, i) => (
              <button
                key={i}
                onClick={() => { setStep(i); setNewFileIds(new Set()); setExpandedId(null); }}
                className={cn(
                  "rounded-full transition-all duration-300",
                  i < step
                    ? `h-2 w-2 ${palette.accent} opacity-60`
                    : i === step
                    ? `h-2.5 w-4 ${palette.accent} ring-2 ${palette.ring}`
                    : "h-2 w-2 bg-slate-200",
                )}
                title={`Step ${i + 1}: ${scenario.steps[i].action}`}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <CtrlBtn onClick={() => navigate(-1)} disabled={isFirst} title="Previous step">
              <ChevronLeft size={14} />
            </CtrlBtn>
            <CtrlBtn onClick={togglePlay} active={playing} title={playing ? "Pause" : "Auto-play"}>
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </CtrlBtn>
            <CtrlBtn onClick={() => navigate(1)} disabled={isComplete} title="Next step">
              <ChevronRight size={14} />
            </CtrlBtn>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <CtrlBtn onClick={reset} title="Exit simulation">
              <RotateCcw size={12} />
            </CtrlBtn>
          </div>
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── What the agent is doing (prominent) ───────────────────── */}
        <div className="border-b border-slate-200/50 bg-white/60 px-5 py-5">
          {/* Action label */}
          <div className="mb-3 flex items-center gap-2">
            <div className={cn("flex h-6 w-6 items-center justify-center rounded-full text-white", palette.accent)}>
              <Cpu size={11} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Agent action — step {step + 1}
            </span>
          </div>
          <p className="text-base font-bold text-slate-900">{currentStep.action}</p>

          {/* Thinking bubble */}
          <div className="mt-3 rounded-2xl border border-violet-200/50 bg-violet-50/60 p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Brain size={12} className="text-violet-500" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-violet-500">Agent reasoning</span>
            </div>
            <p className="text-[13px] leading-6 text-slate-700 italic">
              &ldquo;{currentStep.thinking}&rdquo;
            </p>
          </div>
        </div>

        {/* ── Files being read NOW ───────────────────────────────────── */}
        <div className="px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <Eye size={13} className="text-slate-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Reading now — {currentStep.files.length} file{currentStep.files.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="space-y-3">
            {currentStep.files.map((sf) => {
              const rs = RELEVANCE[sf.relevance];
              const brianFile = findBrianFile(sf.id);
              const isNew = newFileIds.has(sf.id);
              const isExpanded = expandedId === sf.id;
              const tokens = brianFile ? estimateTokens(brianFile.content) : 0;
              const snippet = brianFile?.content
                .split("\n")
                .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"))
                .slice(0, 4)
                .join(" ")
                .slice(0, 280);

              return (
                <div
                  key={sf.id}
                  className={cn(
                    "overflow-hidden rounded-2xl border shadow-sm transition-all duration-300",
                    rs.border, rs.bg,
                    isNew && "ring-2 ring-violet-400/50 scale-[1.01]",
                  )}
                >
                  {/* File header */}
                  <div className="flex items-start gap-3 p-4">
                    <div className={cn("mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full", rs.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800">{sf.title}</p>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", rs.badge)}>
                          {rs.label}
                        </span>
                        {isNew && (
                          <span className="flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-semibold text-white">
                            <Sparkles size={8} />
                            Just loaded
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-slate-500">{sf.reason}</p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      {tokens > 0 && (
                        <span className="text-[9px] tabular-nums text-slate-400">{tokens.toLocaleString()} tok</span>
                      )}
                      {brianFile && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : sf.id)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200/60 bg-white/70 px-2 py-1 text-[9px] font-medium text-slate-500 transition hover:bg-white/90"
                        >
                          <BookOpen size={9} />
                          {isExpanded ? "Close" : "Preview"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable content preview */}
                  {isExpanded && snippet && (
                    <div className="border-t border-slate-200/40 bg-white/60 px-4 pb-4 pt-3">
                      <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        What&apos;s in this file
                      </p>
                      <p className="text-[12px] leading-5 text-slate-600">{snippet}…</p>
                      {brianFile?.frontmatter.keywords?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {brianFile.frontmatter.keywords.slice(0, 6).map((kw) => (
                            <span key={kw} className="rounded-full border border-violet-200/60 bg-violet-50 px-2 py-0.5 text-[9px] text-violet-600">
                              #{kw}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Previously read ───────────────────────────────────────── */}
        {prevFiles.length > 0 && (
          <div className="border-t border-slate-100/80 px-5 pb-5 pt-4">
            <p className="mb-2.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Context already loaded ({prevFiles.length} file{prevFiles.length !== 1 ? "s" : ""})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {prevFiles.map((sf, idx) => {
                const rs = RELEVANCE[sf.relevance];
                return (
                  <span
                    key={`${sf.id}-${idx}`}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium",
                      rs.border,
                      "bg-white/60 text-slate-600",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", rs.dot)} />
                    {sf.title}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Next step preview ─────────────────────────────────────── */}
        {!isComplete && (
          <div className="border-t border-slate-100/80 bg-slate-50/40 px-5 py-4">
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Next → {scenario.steps[step + 1].action}
            </p>
            <div className="flex flex-wrap gap-1.5 opacity-50">
              {scenario.steps[step + 1].files.slice(0, 3).map((f) => (
                <span key={f.id} className="flex items-center gap-1.5 rounded-full border border-slate-200/60 bg-white/60 px-2.5 py-1 text-[10px] text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                  {f.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Completion ────────────────────────────────────────────── */}
        {isComplete && (
          <div className="border-t border-slate-100/80 px-5 pb-6 pt-5">
            <div className={cn("rounded-2xl border p-5", `border-${scenario.colorClass}-200/60 bg-${scenario.colorClass}-50/60`)}>
              <div className="flex items-center gap-2 mb-4">
                <Zap size={15} className={palette.text} />
                <p className={cn("text-sm font-bold", palette.text)}>Context fully loaded — agent is ready</p>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: "Primary", count: allRead.filter((f) => f.relevance === "primary").length, color: "text-violet-700" },
                  { label: "Supporting", count: allRead.filter((f) => f.relevance === "secondary").length, color: "text-sky-700" },
                  { label: "Referenced", count: allRead.filter((f) => f.relevance === "referenced").length, color: "text-slate-500" },
                ].map(({ label, count, color }) => (
                  <div key={label} className="rounded-xl border border-white/80 bg-white/70 px-3 py-3 text-center">
                    <p className={cn("text-2xl font-bold tabular-nums", color)}>{count}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={reset}
                className="w-full rounded-xl border border-white/80 bg-white/70 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-white/90"
              >
                Try another scenario
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── Sticky context window footer ──────────────────────────────── */}
      <div className="border-t border-slate-200/60 bg-white/80 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Context window</span>
              <span className={cn(
                "text-[9px] font-bold tabular-nums",
                ctxPct > 80 ? "text-red-600" : ctxPct > 50 ? "text-amber-600" : "text-emerald-600",
              )}>
                {ctxPct}% used
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200/60">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  ctxPct > 80 ? "bg-red-400" : ctxPct > 50 ? "bg-amber-400" : "bg-emerald-400",
                )}
                style={{ width: `${ctxPct}%` }}
              />
            </div>
          </div>
          <span className="flex-shrink-0 text-[10px] tabular-nums text-slate-500">
            {totalTokens.toLocaleString()} / {CONTEXT_WINDOW.toLocaleString()} tok
          </span>
        </div>
      </div>

    </div>
  );
}

// ─── Scenario picker ──────────────────────────────────────────────────────────

function ScenarioPicker({ onSelect }: { onSelect: (s: Scenario) => void }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200/60 bg-white/70 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100">
            <Brain size={12} className="text-violet-600" />
          </div>
          <p className="text-sm font-bold text-slate-800">Agent Simulation</p>
        </div>
        <p className="text-[11px] leading-5 text-slate-500">
          Pick a task — watch which files the AI reads, in order, and exactly why. Every lit node on the graph is a file the agent has loaded into its context.
        </p>
      </div>

      {/* Scenario grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {SCENARIOS.map((s) => {
            const p = PALETTE[s.colorClass] ?? PALETTE.blue;
            const totalFiles = s.steps.reduce((n, step) => n + step.files.length, 0);
            const estTokens = totalFiles * 150; // rough estimate
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s)}
                className="group flex flex-col gap-3 rounded-2xl border border-slate-200/60 bg-white/70 p-4 text-left shadow-sm transition-all duration-150 hover:scale-[1.02] hover:bg-white/90 hover:shadow-md active:scale-[0.99]"
              >
                {/* Icon + color accent */}
                <div className="flex items-center gap-2.5">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl text-xl", p.light)}>
                    {s.icon}
                  </div>
                  <div className={cn("h-1.5 w-1.5 rounded-full", p.accent)} />
                </div>
                {/* Name + description */}
                <div>
                  <p className={cn("text-sm font-bold", p.text)}>{s.name}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{s.description}</p>
                </div>
                {/* Stats */}
                <div className="flex flex-wrap items-center gap-2 text-[9px] text-slate-400">
                  <span className={cn("rounded-full px-2 py-0.5 font-semibold", p.light, p.text)}>
                    {s.steps.length} steps
                  </span>
                  <span>{totalFiles} files</span>
                  <span>~{Math.round(estTokens / 1000)}k tok</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Explainer */}
        <div className="mt-4 rounded-2xl border border-slate-200/50 bg-white/50 p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            How this works
          </p>
          <div className="space-y-2">
            {[
              { icon: "1", text: "Select a task — the agent has a specific goal in mind" },
              { icon: "2", text: "Step through the reading sequence — each file lights up on the graph above" },
              { icon: "3", text: "See the agent's reasoning — understand why each file matters for the task" },
              { icon: "4", text: "Track context usage — watch the token budget fill up as files are loaded" },
            ].map(({ icon, text }) => (
              <div key={icon} className="flex items-start gap-2.5">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-600 mt-0.5">
                  {icon}
                </span>
                <p className="text-[11px] leading-4 text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Control button ───────────────────────────────────────────────────────────

function CtrlBtn({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-xl transition-all",
        active
          ? "bg-violet-100 text-violet-700 ring-1 ring-violet-300/60"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        disabled && "cursor-default opacity-25",
      )}
    >
      {children}
    </button>
  );
}
