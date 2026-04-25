"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw } from "lucide-react";

import type { BrianFile } from "@/lib/brian/reader";
import {
  getHighlightedNodes,
  SCENARIOS,
  type Relevance,
  type Scenario,
} from "@/lib/brian/scenarios";
import { cn } from "@/lib/utils";

// ─── Token estimation (rough: ~4 chars per token) ────────────────────────────
function estimateTokens(content: string) {
  return Math.round(content.length / 4);
}
const CONTEXT_WINDOW = 8000; // typical agent context budget

// ─── Color maps ──────────────────────────────────────────────────────────────

const SCENARIO_COLORS: Record<string, { border: string; bg: string; dot: string; text: string; pill: string }> = {
  blue:   { border: "border-blue-300/70",   bg: "bg-blue-50/90 hover:bg-blue-100/90",     dot: "bg-blue-500",   text: "text-blue-700",   pill: "bg-blue-100 text-blue-700" },
  red:    { border: "border-red-300/70",    bg: "bg-red-50/90 hover:bg-red-100/90",       dot: "bg-red-500",    text: "text-red-700",    pill: "bg-red-100 text-red-700" },
  green:  { border: "border-green-300/70",  bg: "bg-green-50/90 hover:bg-green-100/90",   dot: "bg-green-500",  text: "text-green-700",  pill: "bg-green-100 text-green-700" },
  purple: { border: "border-purple-300/70", bg: "bg-purple-50/90 hover:bg-purple-100/90", dot: "bg-purple-500", text: "text-purple-700", pill: "bg-purple-100 text-purple-700" },
  orange: { border: "border-orange-300/70", bg: "bg-orange-50/90 hover:bg-orange-100/90", dot: "bg-orange-500", text: "text-orange-700", pill: "bg-orange-100 text-orange-700" },
  cyan:   { border: "border-cyan-300/70",   bg: "bg-cyan-50/90 hover:bg-cyan-100/90",     dot: "bg-cyan-500",   text: "text-cyan-700",   pill: "bg-cyan-100 text-cyan-700" },
};

const RELEVANCE_STYLE: Record<Relevance, { dot: string; badge: string; label: string; cardBg: string }> = {
  primary:    { dot: "bg-violet-600 shadow-[0_0_6px_rgba(139,92,246,0.6)]", badge: "border-violet-300/60 bg-violet-100/80 text-violet-700", label: "Primary",    cardBg: "border-violet-200/60 bg-violet-50/80" },
  secondary:  { dot: "bg-slate-400",  badge: "border-slate-300/60 bg-slate-100/80 text-slate-600",   label: "Secondary",  cardBg: "border-slate-200/40 bg-white/60" },
  referenced: { dot: "bg-slate-300",  badge: "border-slate-200/60 bg-slate-50/80 text-slate-400",    label: "Referenced", cardBg: "border-slate-100/40 bg-white/30" },
};

interface Props {
  files?: BrianFile[];
  onHighlightChange: (map: Map<string, Relevance> | undefined) => void;
}

export function BrainAgentSim({ files = [], onHighlightChange }: Props) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [newFiles, setNewFiles] = useState<Set<string>>(new Set());
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const traceRef = useRef<HTMLDivElement>(null);

  // Look up a brian file by scenario file ID (frontmatter.id)
  function findFile(id: string): BrianFile | undefined {
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
        const newIds = new Set(scenario.steps[next].files.map((f) => f.id));
        setNewFiles(newIds);
        setTimeout(() => setNewFiles(new Set()), 1200);
        return next;
      });
    }, 2800);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, scenario]);

  useEffect(() => {
    setTimeout(() => {
      traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }, [step]);

  function selectScenario(s: Scenario) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScenario(s); setStep(0); setPlaying(false);
    setNewFiles(new Set()); setExpandedFile(null);
  }

  function goStep(delta: number) {
    if (!scenario) return;
    const next = Math.max(0, Math.min(scenario.steps.length - 1, step + delta));
    if (next !== step) {
      const newIds = new Set(scenario.steps[next].files.map((f) => f.id));
      setNewFiles(newIds);
      setTimeout(() => setNewFiles(new Set()), 1200);
    }
    setStep(next);
  }

  function reset() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScenario(null); setStep(0); setPlaying(false);
    setNewFiles(new Set()); setExpandedFile(null);
  }

  function togglePlay() {
    if (!scenario) return;
    if (step >= scenario.steps.length - 1) { setStep(0); setNewFiles(new Set()); }
    setPlaying((p) => !p);
  }

  // Build accumulated file list
  const allStepFiles = scenario
    ? scenario.steps.flatMap((s, i) =>
        i <= step ? s.files.map((f) => ({ ...f, stepIdx: i })) : []
      )
    : [];

  // Context window usage
  const totalTokens = allStepFiles.reduce((sum, sf) => {
    const brian = findFile(sf.id);
    return sum + (brian ? estimateTokens(brian.content) : 150);
  }, 0);
  const ctxPct = Math.min(100, Math.round((totalTokens / CONTEXT_WINDOW) * 100));

  const colors = scenario ? SCENARIO_COLORS[scenario.colorClass] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Scenario picker ───────────────────────────────────────────── */}
      {!scenario ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-700">Agent Simulation</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              Pick a task. Watch which files the agent reads and why — each one lights up on the graph.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SCENARIOS.map((s) => {
              const c = SCENARIO_COLORS[s.colorClass];
              return (
                <button
                  key={s.id}
                  onClick={() => selectScenario(s)}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-2xl border p-3.5 text-left",
                    "transition-all duration-150 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]",
                    c.border, c.bg,
                  )}
                >
                  <span className="text-lg">{s.icon}</span>
                  <div>
                    <p className={cn("text-xs font-semibold", c.text)}>{s.name}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{s.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                    <span className="text-[10px] text-slate-400">{s.steps.length} steps</span>
                    <span className="text-[10px] text-slate-300">·</span>
                    <span className="text-[10px] text-slate-400">
                      {s.steps.reduce((n, st) => n + st.files.length, 0)} files
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* ── Active scenario header ────────────────────────────────── */}
          <div className="flex items-center justify-between border-b border-slate-200/60 bg-white/60 px-4 py-2.5 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="text-sm">{scenario.icon}</span>
              <div>
                <p className={cn("text-xs font-semibold leading-none", colors?.text)}>{scenario.name}</p>
                <p className="mt-0.5 text-[9px] text-slate-400">Step {step + 1} / {scenario.steps.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <StepBtn onClick={() => goStep(-1)} disabled={step === 0}><ChevronLeft size={13} /></StepBtn>
              <StepBtn onClick={togglePlay} active={playing}>{playing ? <Pause size={12} /> : <Play size={12} />}</StepBtn>
              <StepBtn onClick={() => goStep(1)} disabled={step >= scenario.steps.length - 1}><ChevronRight size={13} /></StepBtn>
              <div className="mx-1 h-4 w-px bg-slate-200" />
              <StepBtn onClick={reset}><RotateCcw size={11} /></StepBtn>
            </div>
          </div>

          {/* ── Progress bar + step dots ──────────────────────────────── */}
          <div className="border-b border-slate-100/80 bg-white/40 px-4 py-2">
            <div className="flex items-center gap-1 mb-2">
              {scenario.steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { setStep(i); setNewFiles(new Set()); }}
                  className="group flex items-center gap-1"
                >
                  <div className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i <= step ? cn("w-5", colors?.dot ?? "bg-violet-500") : "w-1.5 bg-slate-200",
                  )} />
                  {i < scenario.steps.length - 1 && <div className="h-px w-1.5 bg-slate-200/80" />}
                </button>
              ))}
            </div>
            {/* Context window bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-slate-200/60">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    ctxPct > 80 ? "bg-red-400" : ctxPct > 50 ? "bg-amber-400" : "bg-emerald-400",
                  )}
                  style={{ width: `${ctxPct}%` }}
                />
              </div>
              <span className="flex-shrink-0 text-[9px] text-slate-400 tabular-nums">
                {ctxPct}% context ({totalTokens.toLocaleString()} tokens)
              </span>
            </div>
          </div>

          {/* ── Current step ─────────────────────────────────────────── */}
          <div className="border-b border-slate-100/80 bg-slate-50/50 px-4 py-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
              Agent action
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-800">{scenario.steps[step].action}</p>
            <p className="mt-1 text-[11px] leading-5 italic text-slate-500">
              &ldquo;{scenario.steps[step].thinking}&rdquo;
            </p>
          </div>

          {/* ── File trace ───────────────────────────────────────────── */}
          <div ref={traceRef} className="flex-1 overflow-y-auto space-y-2 p-3">
            {allStepFiles.map((sf, idx) => {
              const rs = RELEVANCE_STYLE[sf.relevance];
              const isCurrentStep = sf.stepIdx === step;
              const isNew = newFiles.has(sf.id);
              const brianFile = findFile(sf.id);
              const isExpanded = expandedFile === `${sf.id}-${idx}`;

              // Snippet: first meaningful paragraph
              const snippet = brianFile?.content
                .split("\n")
                .filter((l) => l.trim() && !l.startsWith("#"))
                .slice(0, 3)
                .join(" ")
                .slice(0, 220) ?? null;

              const fileTokens = brianFile ? estimateTokens(brianFile.content) : 0;

              return (
                <div
                  key={`${sf.id}-${idx}`}
                  className={cn(
                    "rounded-2xl border transition-all duration-400",
                    rs.cardBg,
                    isNew && "ring-2 ring-violet-300/50",
                  )}
                >
                  <button
                    className="flex w-full items-start gap-2.5 p-3 text-left"
                    onClick={() => setExpandedFile(isExpanded ? null : `${sf.id}-${idx}`)}
                  >
                    <div className={cn("mt-1 h-2 w-2 flex-shrink-0 rounded-full", rs.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("text-xs font-semibold", isCurrentStep ? "text-slate-900" : "text-slate-700")}>
                          {sf.title}
                        </span>
                        <span className={cn("rounded-full border px-1.5 py-0.5 text-[8px] font-medium", rs.badge)}>
                          {rs.label}
                        </span>
                        {isCurrentStep && (
                          <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-medium text-white">
                            now
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{sf.reason}</p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                      {fileTokens > 0 && (
                        <span className="text-[9px] tabular-nums text-slate-400">{fileTokens.toLocaleString()} tok</span>
                      )}
                      <span className="text-[9px] text-slate-300">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Expanded content preview */}
                  {isExpanded && snippet && (
                    <div className="border-t border-slate-200/40 px-3 pb-3">
                      <p className="mb-1.5 mt-2 text-[8px] font-semibold uppercase tracking-widest text-slate-400">
                        File preview
                      </p>
                      <p className="text-[11px] leading-5 text-slate-600">{snippet}…</p>
                      {brianFile?.frontmatter.keywords?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {brianFile.frontmatter.keywords.slice(0, 5).map((kw) => (
                            <span key={kw} className="rounded-full border border-violet-200/60 bg-violet-50 px-1.5 py-0.5 text-[9px] text-violet-600">
                              {kw}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Next step preview */}
            {scenario && step < scenario.steps.length - 1 && (
              <div className="mt-1">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                  Next → {scenario.steps[step + 1].action}
                </p>
                {scenario.steps[step + 1].files.slice(0, 2).map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-xl border border-slate-200/30 bg-white/20 px-3 py-1.5 opacity-40"
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                    <span className="text-[10px] text-slate-500">{f.title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Completion */}
            {scenario && step === scenario.steps.length - 1 && (
              <div className={cn("mt-1 rounded-2xl border p-4", colors?.border, "bg-white/60")}>
                <p className={cn("text-center text-sm font-semibold", colors?.text)}>
                  ✓ Context fully loaded
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Primary", count: allStepFiles.filter((f) => f.relevance === "primary").length, color: "text-violet-700" },
                    { label: "Secondary", count: allStepFiles.filter((f) => f.relevance === "secondary").length, color: "text-slate-600" },
                    { label: "Referenced", count: allStepFiles.filter((f) => f.relevance === "referenced").length, color: "text-slate-400" },
                  ].map(({ label, count, color }) => (
                    <div key={label}>
                      <p className={cn("text-lg font-bold tabular-nums", color)}>{count}</p>
                      <p className="text-[9px] text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200/50 bg-white/60 p-2">
                  <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-200/60">
                    <div
                      className={cn("h-full rounded-full", ctxPct > 80 ? "bg-red-400" : ctxPct > 50 ? "bg-amber-400" : "bg-emerald-400")}
                      style={{ width: `${ctxPct}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-slate-500 tabular-nums">
                    {totalTokens.toLocaleString()} / {CONTEXT_WINDOW.toLocaleString()} tokens
                  </span>
                </div>
                <button
                  onClick={reset}
                  className="mt-3 w-full rounded-xl border border-slate-200/60 bg-white/70 py-1.5 text-xs text-slate-500 transition hover:bg-white/90"
                >
                  Try another scenario
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StepBtn({
  onClick,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-lg transition",
        active
          ? "bg-violet-100 text-violet-700 hover:bg-violet-200"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        disabled && "opacity-25",
      )}
    >
      {children}
    </button>
  );
}
