"use client";

import { useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "agent_start"; agent: "reader" | "writer" }
  | { type: "agent_end"; agent: "reader" | "writer"; text: string }
  | { type: "tool_call"; agent: "reader" | "writer"; tool: string; input: Record<string, unknown>; run_id: string }
  | { type: "tool_result"; agent: "reader" | "writer"; tool: string; output: string; run_id: string }
  | { type: "token"; agent: "reader" | "writer"; content: string }
  | { type: "thinking"; agent: "reader" | "writer"; content: string }
  | { type: "done"; result: string }
  | { type: "error"; message: string }
  | { type: "stream_end" };

// ── Tool definitions ───────────────────────────────────────────────────────────

const READER_LEFT = [
  { id: "list_reference_brain",   label: "list ref brain" },
  { id: "read_reference_file",    label: "read ref file" },
  { id: "search_reference_brain", label: "search ref" },
  { id: "list_working_brain",     label: "list brain" },
  { id: "read_working_file",      label: "read file" },
];

const READER_RIGHT = [
  { id: "search_working_brain",    label: "search brain" },
  { id: "get_working_frontmatter", label: "frontmatter" },
  { id: "semantic_search",         label: "semantic" },
  { id: "get_brief",               label: "get brief" },
];

const WRITER_LEFT = [
  { id: "upsert_working_file",  label: "upsert file" },
  { id: "replace_working_file", label: "replace file" },
];

const WRITER_RIGHT = [
  { id: "propose_update", label: "propose" },
  { id: "record_audit",   label: "audit log" },
];

// ── Layout constants ───────────────────────────────────────────────────────────

const W = 880;

// Agent node dimensions
const AGENT_W = 162;
const AGENT_H = 54;
const CX      = W / 2; // center x

// Tool pill dimensions
const PILL_W  = 108;
const PILL_H  = 26;
const PILL_GAP = 36; // vertical spacing

// Column centers
const L_CX = 106; // left column center x
const R_CX = W - L_CX; // right column center x

// Vertical positions
const READER_Y  = 240;  // reader agent center y
const WRITER_Y  = 456;  // writer agent center y
const START_Y   = 52;
const END_QUERY_Y  = 400;
const END_UPDATE_Y = 576;

// ── Position helpers ───────────────────────────────────────────────────────────

function columnY(tools: { id: string }[], idx: number, centerY: number) {
  const total = tools.length;
  const spanH = (total - 1) * PILL_GAP;
  return centerY - spanH / 2 + idx * PILL_GAP;
}

// ── Bezier path from pill to agent ────────────────────────────────────────────

function pillToAgent(
  side: "left" | "right",
  toolY: number,
  agentY: number,
) {
  const isLeft = side === "left";
  // Tool connection points
  const tx = isLeft ? L_CX + PILL_W / 2 + 2 : R_CX - PILL_W / 2 - 2;
  const ty = toolY;
  // Agent connection points
  const ax = isLeft ? CX - AGENT_W / 2 : CX + AGENT_W / 2;
  const ay = agentY;
  // Control points – horizontal tension
  const tension = Math.abs(ax - tx) * 0.45;
  const cp1x = isLeft ? tx + tension : tx - tension;
  const cp2x = isLeft ? ax - tension : ax + tension;
  return `M ${tx},${ty} C ${cp1x},${ty} ${cp2x},${ay} ${ax},${ay}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  events: AgentEvent[];
  isStreaming: boolean;
  task: "query" | "update";
}

export function LangGraphViz({ events, isStreaming, task }: Props) {
  const s = useMemo(() => {
    const activeAgent = { reader: false, writer: false };
    const activeTools = new Set<string>();
    const completedTools = new Set<string>();
    const calledTools = new Set<string>();
    let readerDone = false;
    let writerDone = false;
    let isDone = false;

    for (const e of events) {
      if (e.type === "agent_start") {
        activeAgent[e.agent] = true;
      } else if (e.type === "agent_end") {
        activeAgent[e.agent] = false;
        if (e.agent === "reader") readerDone = true;
        if (e.agent === "writer") writerDone = true;
      } else if (e.type === "tool_call") {
        activeTools.add(e.tool);
        calledTools.add(e.tool);
      } else if (e.type === "tool_result") {
        activeTools.delete(e.tool);
        completedTools.add(e.tool);
      } else if (e.type === "done") {
        isDone = true;
      }
    }

    return { activeAgent, activeTools, completedTools, calledTools, readerDone, writerDone, isDone };
  }, [events]);

  const showWriter = task === "update";
  const endY = showWriter ? END_UPDATE_Y : END_QUERY_Y;
  const H = showWriter ? 640 : 460;

  const toolState = (id: string) => ({
    active: s.activeTools.has(id),
    done: s.completedTools.has(id),
    called: s.calledTools.has(id),
  });

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-b from-slate-50/80 to-white/60 backdrop-blur-xl shadow-inner">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <style>{`
            @keyframes dash-flow { to { stroke-dashoffset: -20; } }
            @keyframes ring-pulse { 0%,100%{opacity:.18;r:46;} 50%{opacity:.06;r:60;} }
            @keyframes tool-ring  { 0%,100%{opacity:.22;r:16;} 50%{opacity:.06;r:22;} }
            @keyframes dot-blink  { 0%,100%{opacity:1;} 50%{opacity:.15;} }
            .edge-flow  { stroke-dasharray:7 5; animation:dash-flow .7s linear infinite; }
            .ring-anim  { animation:ring-pulse 1.6s ease-in-out infinite; }
            .tool-anim  { animation:tool-ring 1.1s ease-in-out infinite; }
            .dot-anim   { animation:dot-blink .85s ease-in-out infinite; }
          `}</style>

          {/* Arrowheads */}
          {[
            { id: "arr-v",  color: "#8b5cf6", opacity: .9 },
            { id: "arr-ok", color: "#10b981", opacity: .8 },
            { id: "arr-dim",color: "#cbd5e1", opacity: .7 },
          ].map(({ id, color, opacity }) => (
            <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill={color} fillOpacity={opacity}/>
            </marker>
          ))}
          {[
            { id: "arr-sm-v",  color: "#8b5cf6", opacity: .75 },
            { id: "arr-sm-ok", color: "#10b981", opacity: .65 },
            { id: "arr-sm-dim",color: "#e2e8f0", opacity: .8 },
          ].map(({ id, color, opacity }) => (
            <marker key={id} id={id} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={color} fillOpacity={opacity}/>
            </marker>
          ))}

          {/* Glows */}
          <filter id="glow-blue">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
          </filter>
          <filter id="glow-emerald">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
          </filter>
          <filter id="shadow-sm">
            <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#6366f1" floodOpacity=".12"/>
          </filter>
          <filter id="shadow-active">
            <feDropShadow dx="0" dy="3" stdDeviation="8" floodColor="#3b82f6" floodOpacity=".25"/>
          </filter>
          <filter id="shadow-emerald">
            <feDropShadow dx="0" dy="3" stdDeviation="8" floodColor="#10b981" floodOpacity=".25"/>
          </filter>

          {/* Gradient fills */}
          <linearGradient id="grad-reader" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eff6ff"/>
            <stop offset="100%" stopColor="#dbeafe"/>
          </linearGradient>
          <linearGradient id="grad-reader-active" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dbeafe"/>
            <stop offset="100%" stopColor="#bfdbfe"/>
          </linearGradient>
          <linearGradient id="grad-writer" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ecfdf5"/>
            <stop offset="100%" stopColor="#d1fae5"/>
          </linearGradient>
          <linearGradient id="grad-writer-active" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d1fae5"/>
            <stop offset="100%" stopColor="#a7f3d0"/>
          </linearGradient>
        </defs>

        {/* ── Section labels ─────────────────────────────────────────────── */}
        <SectionLabel x={L_CX} y={READER_Y - 74} label="READ TOOLS" color="#3b82f6"
          visible={s.activeAgent.reader || s.readerDone || isStreaming} />
        <SectionLabel x={R_CX} y={READER_Y - 74} label="READ TOOLS" color="#3b82f6"
          visible={s.activeAgent.reader || s.readerDone || isStreaming} />
        {showWriter && (
          <>
            <SectionLabel x={L_CX} y={WRITER_Y - 52} label="WRITE TOOLS" color="#10b981"
              visible={s.activeAgent.writer || s.writerDone} />
            <SectionLabel x={R_CX} y={WRITER_Y - 52} label="WRITE TOOLS" color="#10b981"
              visible={s.activeAgent.writer || s.writerDone} />
          </>
        )}

        {/* ── Tool edges (drawn BEFORE nodes so nodes sit on top) ─────────── */}
        {READER_LEFT.map((t, i) => {
          const ty = columnY(READER_LEFT, i, READER_Y);
          const ts = toolState(t.id);
          return (
            <BezierEdge key={t.id}
              d={pillToAgent("left", ty, READER_Y)}
              active={ts.active} done={ts.done} called={ts.called}
              markerActive="url(#arr-sm-v)" markerDone="url(#arr-sm-ok)" markerDim="url(#arr-sm-dim)"
            />
          );
        })}
        {READER_RIGHT.map((t, i) => {
          const ty = columnY(READER_RIGHT, i, READER_Y);
          const ts = toolState(t.id);
          return (
            <BezierEdge key={t.id}
              d={pillToAgent("right", ty, READER_Y)}
              active={ts.active} done={ts.done} called={ts.called}
              markerActive="url(#arr-sm-v)" markerDone="url(#arr-sm-ok)" markerDim="url(#arr-sm-dim)"
            />
          );
        })}
        {showWriter && WRITER_LEFT.map((t, i) => {
          const ty = columnY(WRITER_LEFT, i, WRITER_Y);
          const ts = toolState(t.id);
          return (
            <BezierEdge key={t.id}
              d={pillToAgent("left", ty, WRITER_Y)}
              active={ts.active} done={ts.done} called={ts.called}
              markerActive="url(#arr-sm-v)" markerDone="url(#arr-sm-ok)" markerDim="url(#arr-sm-dim)"
            />
          );
        })}
        {showWriter && WRITER_RIGHT.map((t, i) => {
          const ty = columnY(WRITER_RIGHT, i, WRITER_Y);
          const ts = toolState(t.id);
          return (
            <BezierEdge key={t.id}
              d={pillToAgent("right", ty, WRITER_Y)}
              active={ts.active} done={ts.done} called={ts.called}
              markerActive="url(#arr-sm-v)" markerDone="url(#arr-sm-ok)" markerDim="url(#arr-sm-dim)"
            />
          );
        })}

        {/* ── Main spine edges ───────────────────────────────────────────── */}
        {/* START → Reader */}
        <SpineEdge
          x={CX} y1={START_Y + 14} y2={READER_Y - AGENT_H / 2 - 1}
          active={s.activeAgent.reader || s.readerDone || isStreaming}
          done={s.readerDone}
        />

        {/* Reader → Writer or → END */}
        {showWriter ? (
          <SpineEdge
            x={CX} y1={READER_Y + AGENT_H / 2 + 1} y2={WRITER_Y - AGENT_H / 2 - 1}
            active={s.activeAgent.writer || s.writerDone}
            done={s.writerDone}
            label="handoff"
          />
        ) : (
          <SpineEdge
            x={CX} y1={READER_Y + AGENT_H / 2 + 1} y2={endY - 14}
            active={s.isDone}
            done={s.isDone}
          />
        )}

        {/* Writer → END */}
        {showWriter && (
          <SpineEdge
            x={CX} y1={WRITER_Y + AGENT_H / 2 + 1} y2={endY - 14}
            active={s.isDone}
            done={s.isDone}
          />
        )}

        {/* ── START node ────────────────────────────────────────────────── */}
        <StartNode x={CX} y={START_Y} active={isStreaming && !s.readerDone} />

        {/* ── Reader Agent ──────────────────────────────────────────────── */}
        <AgentNode
          x={CX} y={READER_Y}
          label="Reader Agent"
          sub="semantic retrieval  ·  read-only"
          active={s.activeAgent.reader}
          done={s.readerDone}
          color="blue"
        />

        {/* Reader tools */}
        {READER_LEFT.map((t, i) => (
          <ToolPill key={t.id}
            cx={L_CX} cy={columnY(READER_LEFT, i, READER_Y)}
            label={t.label} side="left"
            {...toolState(t.id)}
            color="blue"
          />
        ))}
        {READER_RIGHT.map((t, i) => (
          <ToolPill key={t.id}
            cx={R_CX} cy={columnY(READER_RIGHT, i, READER_Y)}
            label={t.label} side="right"
            {...toolState(t.id)}
            color="blue"
          />
        ))}

        {/* ── Writer Agent ──────────────────────────────────────────────── */}
        {showWriter && (
          <>
            <AgentNode
              x={CX} y={WRITER_Y}
              label="Writer Agent"
              sub="upsert  ·  replace  ·  reconcile"
              active={s.activeAgent.writer}
              done={s.writerDone}
              color="emerald"
            />
            {WRITER_LEFT.map((t, i) => (
              <ToolPill key={t.id}
                cx={L_CX} cy={columnY(WRITER_LEFT, i, WRITER_Y)}
                label={t.label} side="left"
                {...toolState(t.id)}
                color="emerald"
              />
            ))}
            {WRITER_RIGHT.map((t, i) => (
              <ToolPill key={t.id}
                cx={R_CX} cy={columnY(WRITER_RIGHT, i, WRITER_Y)}
                label={t.label} side="right"
                {...toolState(t.id)}
                color="emerald"
              />
            ))}
          </>
        )}

        {/* ── END node ──────────────────────────────────────────────────── */}
        <EndNode x={CX} y={endY} done={s.isDone} />

        {/* ── Overlay badges ────────────────────────────────────────────── */}
        {isStreaming && !s.isDone && (
          <g>
            <rect x={W - 102} y={12} width={90} height={24} rx={12}
              fill="#8b5cf6" fillOpacity=".1" stroke="#8b5cf6" strokeOpacity=".3" strokeWidth="1"/>
            <circle cx={W - 90} cy={24} r={4} fill="#8b5cf6">
              <animate attributeName="opacity" values="1;0.15;1" dur=".9s" repeatCount="indefinite"/>
            </circle>
            <text x={W - 81} y={28.5} fill="#6d28d9" fontSize="9.5" fontWeight="700" fontFamily="ui-sans-serif,system-ui,sans-serif">
              RUNNING
            </text>
          </g>
        )}
        {s.isDone && (
          <g>
            <rect x={W - 84} y={12} width={72} height={24} rx={12}
              fill="#10b981" fillOpacity=".12" stroke="#10b981" strokeOpacity=".4" strokeWidth="1"/>
            <circle cx={W - 72} cy={24} r={4} fill="#10b981"/>
            <text x={W - 63} y={28.5} fill="#047857" fontSize="9.5" fontWeight="700" fontFamily="ui-sans-serif,system-ui,sans-serif">
              DONE
            </text>
          </g>
        )}

        {/* ── Legend ────────────────────────────────────────────────────── */}
        <g transform="translate(12,12)">
          <rect width="122" height={showWriter ? 72 : 56} rx="10"
            fill="rgba(255,255,255,0.82)" stroke="rgba(203,213,225,0.5)" strokeWidth="1"/>
          <text x="10" y="17" fill="#94a3b8" fontSize="7" fontWeight="800"
            letterSpacing="1.5" fontFamily="ui-monospace,monospace">LEGEND</text>
          {[
            { cy: 32, fill: "#3b82f6", label: "Reader Agent" },
            ...(showWriter ? [{ cy: 48, fill: "#10b981", label: "Writer Agent" }] : []),
            { cy: showWriter ? 64 : 48, fill: "#8b5cf6", label: "Active edge" },
          ].map(({ cy, fill, label }) => (
            <g key={label}>
              <circle cx={18} cy={cy} r={5} fill={fill} fillOpacity=".85"/>
              <text x={30} y={cy + 4} fill="#475569" fontSize="9" fontFamily="ui-sans-serif,system-ui,sans-serif">{label}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ x, y, label, color, visible }: {
  x: number; y: number; label: string; color: string; visible: boolean;
}) {
  return (
    <text x={x} y={y} textAnchor="middle"
      fill={visible ? color : "#cbd5e1"}
      fontSize="7.5" fontWeight="800" letterSpacing="1.8"
      fontFamily="ui-monospace,monospace"
      fillOpacity={visible ? 0.7 : 0.4}
    >{label}</text>
  );
}

function StartNode({ x, y, active }: { x: number; y: number; active: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={13}
        fill="white" stroke={active ? "#8b5cf6" : "#e2e8f0"}
        strokeWidth={active ? 1.5 : 1}/>
      <text x={x} y={y + 4} textAnchor="middle"
        fill={active ? "#7c3aed" : "#94a3b8"}
        fontSize="8" fontWeight="700" fontFamily="ui-monospace,monospace">START</text>
    </g>
  );
}

function EndNode({ x, y, done }: { x: number; y: number; done: boolean }) {
  return (
    <g>
      {done && (
        <circle cx={x} cy={y} r={22} fill="none"
          stroke="#10b981" strokeWidth="1" strokeOpacity=".25" className="ring-anim"/>
      )}
      <circle cx={x} cy={y} r={13}
        fill={done ? "#ecfdf5" : "white"}
        stroke={done ? "#10b981" : "#e2e8f0"}
        strokeWidth={done ? 2 : 1}/>
      <text x={x} y={y + 4} textAnchor="middle"
        fill={done ? "#059669" : "#94a3b8"}
        fontSize="8" fontWeight="700" fontFamily="ui-monospace,monospace">END</text>
    </g>
  );
}

function AgentNode({ x, y, label, sub, active, done, color }: {
  x: number; y: number; label: string; sub: string;
  active: boolean; done: boolean; color: "blue" | "emerald";
}) {
  const isBlue = color === "blue";
  const primary   = isBlue ? "#3b82f6" : "#10b981";
  const gradFill  = active ? (isBlue ? "url(#grad-reader-active)" : "url(#grad-writer-active)")
                  : done   ? (isBlue ? "url(#grad-reader)"        : "url(#grad-writer)")
                  :          "white";
  const borderCol = active || done ? primary : "#e2e8f0";
  const borderW   = active ? 2 : done ? 1.5 : 1;
  const labelCol  = active || done ? (isBlue ? "#1e40af" : "#065f46") : "#334155";
  const subCol    = active || done ? (isBlue ? "#3b82f6" : "#10b981") : "#94a3b8";
  const filterId  = active ? (isBlue ? "url(#shadow-active)" : "url(#shadow-emerald)")
                  : done   ? "url(#shadow-sm)" : undefined;

  return (
    <g filter={filterId}>
      {/* Pulse ring */}
      {active && (
        <rect
          x={x - AGENT_W / 2 - 10} y={y - AGENT_H / 2 - 10}
          width={AGENT_W + 20} height={AGENT_H + 20}
          rx={24} fill={primary} fillOpacity=".06"
          stroke="none" className="ring-anim"
        />
      )}

      {/* Main card */}
      <rect
        x={x - AGENT_W / 2} y={y - AGENT_H / 2}
        width={AGENT_W} height={AGENT_H}
        rx={14}
        fill={gradFill}
        stroke={borderCol}
        strokeWidth={borderW}
      />

      {/* Active indicator dot */}
      {active && (
        <circle cx={x + AGENT_W / 2 - 10} cy={y - AGENT_H / 2 + 10} r={4}
          fill={primary} className="dot-anim"/>
      )}
      {done && !active && (
        <circle cx={x + AGENT_W / 2 - 10} cy={y - AGENT_H / 2 + 10} r={4}
          fill={primary} fillOpacity=".55"/>
      )}

      {/* Label */}
      <text x={x} y={y - 7} textAnchor="middle"
        fill={labelCol} fontSize="13" fontWeight="700"
        fontFamily="ui-sans-serif,system-ui,sans-serif">{label}</text>

      {/* Sub */}
      <text x={x} y={y + 10} textAnchor="middle"
        fill={subCol} fontSize="9"
        fontFamily="ui-sans-serif,system-ui,sans-serif">{sub}</text>
    </g>
  );
}

function ToolPill({ cx, cy, label, side, active, done, called, color }: {
  cx: number; cy: number; label: string; side: "left" | "right";
  active: boolean; done: boolean; called: boolean; color: "blue" | "emerald";
}) {
  const isBlue  = color === "blue";
  const primary = isBlue ? "#3b82f6" : "#10b981";
  const x = cx - PILL_W / 2;
  const y = cy - PILL_H / 2;

  const bg = active ? (isBlue ? "#dbeafe" : "#d1fae5")
           : done   ? (isBlue ? "#eff6ff" : "#ecfdf5")
           : called ? "#f8fafc" : "#f8fafc";
  const border  = active ? primary : done ? (isBlue ? "#93c5fd" : "#6ee7b7") : "#e2e8f0";
  const textCol = active ? (isBlue ? "#1d4ed8" : "#065f46")
                : done   ? (isBlue ? "#2563eb" : "#059669")
                : called ? "#64748b" : "#94a3b8";
  const dotCol  = active ? primary : done ? primary : called ? "#94a3b8" : "#e2e8f0";

  return (
    <g>
      {/* Pulse ring for active */}
      {active && (
        <rect x={x - 4} y={y - 4} width={PILL_W + 8} height={PILL_H + 8}
          rx={17} fill={primary} fillOpacity=".08" stroke="none" className="tool-anim"/>
      )}

      {/* Pill bg */}
      <rect x={x} y={y} width={PILL_W} height={PILL_H} rx={13}
        fill={bg} stroke={border} strokeWidth={active ? 1.5 : 1}/>

      {/* Status dot */}
      <circle
        cx={side === "left" ? x + 10 : x + PILL_W - 10}
        cy={cy} r={3}
        fill={dotCol}
        className={active ? "dot-anim" : undefined}
      />

      {/* Label */}
      <text
        x={side === "left" ? x + 20 : x + PILL_W - 20}
        y={cy + 4}
        textAnchor={side === "left" ? "start" : "end"}
        fill={textCol}
        fontSize="9.5"
        fontWeight={active ? "700" : "500"}
        fontFamily="ui-monospace,monospace"
      >{label}</text>
    </g>
  );
}

function BezierEdge({ d, active, done, called, markerActive, markerDone, markerDim }: {
  d: string; active: boolean; done: boolean; called: boolean;
  markerActive: string; markerDone: string; markerDim: string;
}) {
  const stroke = active ? "#8b5cf6" : done ? "#10b981" : called ? "#e2e8f0" : "#f1f5f9";
  const marker = active ? markerActive : done ? markerDone : markerDim;
  const width  = active ? 1.5 : done ? 1 : 0.75;

  return (
    <path d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={active ? "7 5" : done ? "none" : "4 6"}
      markerEnd={marker}
      className={active ? "edge-flow" : undefined}
    />
  );
}

function SpineEdge({ x, y1, y2, active, done, label }: {
  x: number; y1: number; y2: number;
  active: boolean; done: boolean; label?: string;
}) {
  const stroke = active ? "#8b5cf6" : done ? "#10b981" : "#e2e8f0";
  const marker = active ? "url(#arr-v)" : done ? "url(#arr-ok)" : "url(#arr-dim)";
  const midY   = (y1 + y2) / 2;

  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2}
        stroke={stroke}
        strokeWidth={active ? 2 : done ? 1.5 : 1.5}
        strokeDasharray={active ? "7 5" : done ? "none" : "5 6"}
        markerEnd={marker}
        className={active ? "edge-flow" : undefined}
      />
      {label && (
        <text x={x + 8} y={midY + 4}
          fill="#94a3b8" fontSize="8.5"
          fontFamily="ui-sans-serif,system-ui,sans-serif">{label}</text>
      )}
    </g>
  );
}
