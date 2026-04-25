"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, Search, X } from "lucide-react";

import type { GraphData, GraphNode } from "@/lib/brian/reader";
import type { Relevance } from "@/lib/brian/scenarios";
import { cn } from "@/lib/utils";

// ─── visual constants ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  index: "#f59e0b",
  architecture: "#3b82f6",
  decision: "#ef4444",
  decision_log: "#ef4444",
  integration: "#22c55e",
  agent_prompt: "#a855f7",
  summary: "#06b6d4",
  context: "#94a3b8",
  goals: "#ec4899",
  map: "#f97316",
  unknown: "#64748b",
};

function nodeColor(type: string) {
  return TYPE_COLORS[type] ?? "#64748b";
}
function nodeRadius(val: number) {
  return Math.max(6, val * 2.6);
}

// ─── simulation ────────────────────────────────────────────────────────────────

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };
type SimLink = { source: SimNode; target: SimNode };

function initNodes(nodes: GraphNode[]): SimNode[] {
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = 150 + Math.random() * 40;
    return { ...n, x: r * Math.cos(angle), y: r * Math.sin(angle), vx: 0, vy: 0 };
  });
}

function buildLinks(simNodes: SimNode[], raw: GraphData["links"]): SimLink[] {
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  return raw.flatMap((l) => {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    return s && t ? [{ source: s, target: t }] : [];
  });
}

const REPULSION = 7500;
const IDEAL_LEN = 140;
const SPRING = 0.018;
const GRAVITY = 0.008;
const DAMP = 0.78;

function tick(nodes: SimNode[], links: SimLink[], alpha: number) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (REPULSION * alpha) / (d * d);
      const fx = (f * dx) / d, fy = (f * dy) / d;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
  }
  for (const { source: s, target: t } of links) {
    const dx = t.x - s.x, dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - IDEAL_LEN) * SPRING * alpha) / d;
    const fx = f * dx, fy = f * dy;
    s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
  }
  for (const n of nodes) {
    n.vx -= n.x * GRAVITY * alpha;
    n.vy -= n.y * GRAVITY * alpha;
    n.vx *= DAMP; n.vy *= DAMP;
    n.x += n.vx; n.y += n.vy;
  }
}

// ─── component ─────────────────────────────────────────────────────────────────

interface Props {
  graphData: GraphData;
  onNodeSelect?: (node: GraphNode | null) => void;
  selectedId?: string;
  highlightMap?: Map<string, Relevance>;
}

export function BrainGraph({ graphData, onNodeSelect, selectedId, highlightMap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const sizeRef = useRef({ w: 800, h: 600 });

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const searchQueryRef = useRef("");
  const filterTypeRef2 = useRef<string | null>(null);

  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const viewRef = useRef({ ox: 0, oy: 0, k: 1 });

  const hoverIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  const draggingRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ mx: number; my: number; ox0: number; oy0: number } | null>(null);

  const [tooltipNode, setTooltipNode] = useState<SimNode | null>(null);
  const hoverNodeRef = useRef<SimNode | null>(null);
  // Connected node IDs for the currently hovered node
  const hovConnectedRef = useRef<Set<string>>(new Set());

  const highlightMapRef = useRef<Map<string, Relevance> | undefined>(highlightMap);
  const highlightAlphaRef = useRef(0);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { highlightMapRef.current = highlightMap; }, [highlightMap]);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { filterTypeRef2.current = filterType; }, [filterType]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ob = new ResizeObserver(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      sizeRef.current = { w, h };
      setSize({ w, h });
    });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const { ox, oy, k } = viewRef.current;
    const hovId = hoverIdRef.current;
    const selId = selectedIdRef.current;
    const hmap = highlightMapRef.current;
    const searchQ = searchQueryRef.current.toLowerCase().trim();
    const fType = filterTypeRef2.current;
    const hovConnected = hovConnectedRef.current;

    const targetHL = hmap && hmap.size > 0 ? 1 : 0;
    highlightAlphaRef.current += (targetHL - highlightAlphaRef.current) * 0.07;
    const hl = highlightAlphaRef.current;

    const pulse = Math.sin(Date.now() / 420) * 0.5 + 0.5;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + ox, h / 2 + oy);
    ctx.scale(k, k);

    const inHighlightMode = hl > 0.1 && hmap && hmap.size > 0;
    const inSearchMode = !inHighlightMode && (!!searchQ || !!fType);
    const inHoverMode = !inHighlightMode && !!hovId;

    // Helper: does a node match current filters?
    function nodeMatches(n: SimNode): boolean {
      const matchesSearch = !searchQ || n.label.toLowerCase().includes(searchQ) || n.type.toLowerCase().includes(searchQ);
      const matchesFilter = !fType || n.type === fType;
      return matchesSearch && matchesFilter;
    }

    // ── links ────────────────────────────────────────────────────────────────
    for (const { source: s, target: t } of linksRef.current) {
      const dx = t.x - s.x, dy = t.y - s.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nr = nodeRadius(t.val);
      const ex = t.x - (dx / len) * (nr + 7);
      const ey = t.y - (dy / len) * (nr + 7);
      const ang = Math.atan2(dy, dx);
      const al = 7 / k;

      const sRel = hmap?.get(s.id);
      const tRel = hmap?.get(t.id);
      const bothHighlighted = hl > 0.1 && sRel && tRel;
      const isLinkedToHov = hovId && (s.id === hovId || t.id === hovId);
      const isLinkedToSel = selId && (s.id === selId || t.id === selId);
      const sMatches = nodeMatches(s), tMatches = nodeMatches(t);

      let lineColor: string;
      let lineWidth: number;
      let arrowColor: string;

      if (bothHighlighted) {
        const bright = sRel === "primary" && tRel === "primary";
        lineColor = nodeColor(s.type) + (bright ? "CC" : "77");
        lineWidth = (bright ? 2 : 1.2) / k;
        arrowColor = nodeColor(s.type) + (bright ? "AA" : "55");
      } else if (inHoverMode && isLinkedToHov) {
        lineColor = nodeColor(s.type) + "CC";
        lineWidth = 2 / k;
        arrowColor = nodeColor(s.type) + "99";
      } else if (inHoverMode && !isLinkedToHov) {
        lineColor = `rgba(100,116,139,0.04)`;
        lineWidth = 0.4 / k;
        arrowColor = `rgba(100,116,139,0.03)`;
      } else if (inSearchMode && (!sMatches || !tMatches)) {
        lineColor = `rgba(100,116,139,0.04)`;
        lineWidth = 0.4 / k;
        arrowColor = `rgba(100,116,139,0.03)`;
      } else if (!inHighlightMode && (isLinkedToSel)) {
        lineColor = nodeColor(s.type) + "99";
        lineWidth = 1.4 / k;
        arrowColor = nodeColor(s.type) + "66";
      } else {
        const dimFactor = 1 - hl * 0.82;
        const a = Math.round(0.13 * dimFactor * 255).toString(16).padStart(2, "0");
        lineColor = `#64748b${a}`;
        lineWidth = 0.8 / k;
        arrowColor = `#64748b${a}`;
      }

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - al * Math.cos(ang - 0.45), ey - al * Math.sin(ang - 0.45));
      ctx.lineTo(ex - al * Math.cos(ang + 0.45), ey - al * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = arrowColor;
      ctx.fill();
    }

    // ── nodes ────────────────────────────────────────────────────────────────
    for (const n of nodesRef.current) {
      const r = nodeRadius(n.val);
      const c = nodeColor(n.type);
      const isHov = hovId === n.id;
      const isSel = selId === n.id;
      const relevance = hmap?.get(n.id);
      const matches = nodeMatches(n);
      const isConnectedToHov = hovConnected.has(n.id);

      let opacity: number;
      if (inHighlightMode) {
        opacity = relevance ? 1 : Math.max(0.08, 0.2 - hl * 0.15);
      } else if (inSearchMode && !matches) {
        opacity = 0.1;
      } else if (inHoverMode && !isHov && !isConnectedToHov) {
        opacity = 0.3;
      } else {
        opacity = 1;
      }

      ctx.globalAlpha = opacity;

      // Glow effects
      if (relevance === "primary" && inHighlightMode) {
        const glowR = r + (14 + pulse * 12) / k;
        const grd = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, glowR);
        grd.addColorStop(0, `${c}${Math.round((0.35 + pulse * 0.3) * 255).toString(16).padStart(2, "0")}`);
        grd.addColorStop(1, `${c}00`);
        ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
        // Pulsing ring
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (4 + pulse * 5) / k, 0, Math.PI * 2);
        ctx.strokeStyle = `${c}${Math.round((0.7 + pulse * 0.25) * 255).toString(16).padStart(2, "0")}`;
        ctx.lineWidth = (1.5 + pulse * 1.5) / k;
        ctx.stroke();
      } else if (relevance === "secondary" && inHighlightMode) {
        const grd = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r + 12 / k);
        grd.addColorStop(0, `${c}33`); grd.addColorStop(1, `${c}00`);
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 12 / k, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
      } else if ((isHov || isSel || isConnectedToHov) && !inHighlightMode) {
        const glowSize = isHov ? 22 : isConnectedToHov ? 14 : 18;
        const grd = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r + glowSize / k);
        grd.addColorStop(0, `${c}44`); grd.addColorStop(1, `${c}00`);
        ctx.beginPath(); ctx.arc(n.x, n.y, r + glowSize / k, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
      }

      // Node fill
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      const brightFill = (inHighlightMode && relevance) || isHov || isSel || isConnectedToHov;
      ctx.fillStyle = brightFill ? c : `${c}BB`;
      ctx.fill();

      // Node stroke
      const strongBorder = isSel || (relevance === "primary" && hl > 0.5);
      ctx.strokeStyle = strongBorder ? "rgba(139,92,246,0.85)" : "rgba(15,23,42,0.12)";
      ctx.lineWidth = (strongBorder ? 2.5 : 0.8) / k;
      ctx.stroke();

      // Connection ring for hovered node
      if (isHov && !inHighlightMode) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (3 + pulse * 2) / k, 0, Math.PI * 2);
        ctx.strokeStyle = `${c}${Math.round((0.6 + pulse * 0.3) * 255).toString(16).padStart(2, "0")}`;
        ctx.lineWidth = (1.5 + pulse) / k;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Label
      if (k >= 0.25) {
        const labelOpacity = inHighlightMode
          ? relevance === "primary" ? 1 : relevance === "secondary" ? 0.8 : relevance === "referenced" ? 0.55 : opacity
          : inSearchMode && !matches ? 0.1
          : inHoverMode && !isHov && !isConnectedToHov ? 0.2
          : (isHov || isSel ? 1 : 0.75);
        ctx.globalAlpha = labelOpacity;
        const isBold = relevance === "primary" || isHov || isSel;
        ctx.font = `${isBold ? "600 " : ""}${Math.round(11 / Math.min(k, 1.5))}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.font = `${isBold ? "600 " : ""}11px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isHov || relevance === "primary" || isSel ? "#0f172a" : "#64748b";
        const lbl = n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label;
        ctx.fillText(lbl, n.x, n.y + r + 3 / k);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();

    // Imperatively update tooltip position
    if (hoverNodeRef.current && tooltipRef.current) {
      const n = hoverNodeRef.current;
      const cx = w / 2 + ox + n.x * k + 16;
      const cy = h / 2 + oy + n.y * k - 14;
      tooltipRef.current.style.left = `${cx}px`;
      tooltipRef.current.style.top = `${cy}px`;
    }
  }, []);

  // ── init & animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!graphData.nodes.length) return;
    nodesRef.current = initNodes(graphData.nodes);
    linksRef.current = buildLinks(nodesRef.current, graphData.links);
    alphaRef.current = 1;
    viewRef.current = { ox: 0, oy: 0, k: 1 };
    cancelAnimationFrame(rafRef.current);

    function frame() {
      if (alphaRef.current > 0.004) {
        alphaRef.current *= 0.97;
        tick(nodesRef.current, linksRef.current, alphaRef.current);
      }
      drawFrame();
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [graphData, drawFrame]);

  // ── coordinate helpers ─────────────────────────────────────────────────────
  function toSim(cx: number, cy: number) {
    const { w, h } = sizeRef.current;
    const { ox, oy, k } = viewRef.current;
    return { x: (cx - w / 2 - ox) / k, y: (cy - h / 2 - oy) / k };
  }

  function findNode(cx: number, cy: number): SimNode | null {
    const sim = toSim(cx, cy);
    for (const n of nodesRef.current) {
      const hit = nodeRadius(n.val) + 6;
      const dx = sim.x - n.x, dy = sim.y - n.y;
      if (dx * dx + dy * dy < hit * hit) return n;
    }
    return null;
  }

  // ── event handlers ─────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    const node = findNode(cx, cy);
    if (node) {
      draggingRef.current = node;
      alphaRef.current = Math.max(alphaRef.current, 0.3);
    } else {
      const { ox, oy } = viewRef.current;
      panRef.current = { mx: cx, my: cy, ox0: ox, oy0: oy };
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;

    if (draggingRef.current) {
      const sim = toSim(cx, cy);
      draggingRef.current.x = sim.x;
      draggingRef.current.y = sim.y;
      draggingRef.current.vx = 0;
      draggingRef.current.vy = 0;
    } else if (panRef.current) {
      const { mx, my, ox0, oy0 } = panRef.current;
      viewRef.current = { ...viewRef.current, ox: ox0 + (cx - mx), oy: oy0 + (cy - my) };
    }

    const node = findNode(cx, cy);
    if (node?.id !== hoverIdRef.current) {
      hoverIdRef.current = node?.id ?? null;
      hoverNodeRef.current = node;
      // Compute connected nodes for hover glow
      if (node) {
        const connected = new Set<string>();
        for (const link of linksRef.current) {
          if (link.source.id === node.id) connected.add(link.target.id);
          if (link.target.id === node.id) connected.add(link.source.id);
        }
        hovConnectedRef.current = connected;
      } else {
        hovConnectedRef.current = new Set();
      }
      setTooltipNode(node);
    }
  }

  function onMouseUp() {
    draggingRef.current = null;
    panRef.current = null;
  }

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    onNodeSelect?.(findNode(cx, cy) ?? null);
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.88;
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    const { w, h } = sizeRef.current;
    const { ox, oy, k } = viewRef.current;
    const simX = (cx - w / 2 - ox) / k;
    const simY = (cy - h / 2 - oy) / k;
    const newK = Math.max(0.1, Math.min(5, k * factor));
    viewRef.current = { k: newK, ox: cx - w / 2 - simX * newK, oy: cy - h / 2 - simY * newK };
  }

  function zoomBy(factor: number) {
    const { w, h } = sizeRef.current;
    const { ox, oy, k } = viewRef.current;
    const cx = w / 2, cy = h / 2;
    const simX = (cx - w / 2 - ox) / k;
    const simY = (cy - h / 2 - oy) / k;
    const newK = Math.max(0.1, Math.min(5, k * factor));
    viewRef.current = { k: newK, ox: cx - w / 2 - simX * newK, oy: cy - h / 2 - simY * newK };
  }

  function resetView() {
    viewRef.current = { ox: 0, oy: 0, k: 1 };
  }

  const uniqueTypes = [...new Set(graphData.nodes.map((n) => n.type))];

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        width={size.w}
        height={size.h}
        className="block cursor-grab active:cursor-grabbing"
        style={{ background: "radial-gradient(ellipse at 50% 25%, #dbeafe 0%, #eff6ff 55%, #f5f3ff 100%)" }}
        suppressHydrationWarning
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          draggingRef.current = null;
          panRef.current = null;
          hoverIdRef.current = null;
          hoverNodeRef.current = null;
          hovConnectedRef.current = new Set();
          setTooltipNode(null);
        }}
        onClick={onClick}
        onWheel={onWheel}
      />

      {/* ── Search bar ────────────────────────────────────────────────────── */}
      <div className="absolute left-4 top-4 flex items-center gap-2">
        {showSearch ? (
          <div className="flex items-center gap-2 rounded-2xl border border-white/80 bg-white/90 px-3 py-2 shadow-md backdrop-blur-2xl">
            <Search size={13} className="flex-shrink-0 text-slate-400" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes…"
              className="w-44 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
            <button
              onClick={() => { setSearchQuery(""); setShowSearch(false); }}
              className="ml-1 rounded-lg p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-1.5 rounded-2xl border border-white/80 bg-white/80 px-3 py-2 text-xs text-slate-500 shadow-sm backdrop-blur-2xl transition hover:bg-white/95 hover:text-slate-700"
          >
            <Search size={13} />
            Search
          </button>
        )}
        {filterType && (
          <div className="flex items-center gap-1.5 rounded-2xl border border-white/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-2xl">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: nodeColor(filterType) }} />
            <span className="text-xs font-medium capitalize text-slate-600">{filterType.replace(/_/g, " ")}</span>
            <button onClick={() => setFilterType(null)} className="ml-1 text-slate-400 hover:text-slate-600">
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* ── Legend (clickable type filter) ────────────────────────────────── */}
      <div className="absolute bottom-5 left-5 rounded-2xl border border-white/80 bg-white/85 px-3 py-3 shadow-md backdrop-blur-2xl">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
          {filterType ? "Filtered by type — click to clear" : "Click type to filter"}
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {uniqueTypes.map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? null : type)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-all duration-150",
                filterType === type
                  ? "bg-slate-100 text-slate-800 font-medium"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                filterType && filterType !== type ? "opacity-40" : "",
              )}
            >
              <div
                className="h-2 w-2 flex-shrink-0 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: nodeColor(type) }}
              />
              <span className="text-[10px] capitalize">{type.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Zoom controls ─────────────────────────────────────────────────── */}
      <div className="absolute bottom-5 right-5 flex flex-col gap-1 rounded-2xl border border-white/80 bg-white/85 p-1.5 shadow-md backdrop-blur-2xl">
        <ZoomBtn onClick={() => zoomBy(1.3)} title="Zoom in"><Plus size={13} /></ZoomBtn>
        <ZoomBtn onClick={resetView} title="Reset view"><RotateCcw size={12} /></ZoomBtn>
        <ZoomBtn onClick={() => zoomBy(0.77)} title="Zoom out"><Minus size={13} /></ZoomBtn>
      </div>

      {/* ── Hover tip ─────────────────────────────────────────────────────── */}
      {!tooltipNode && (
        <div className="pointer-events-none absolute bottom-20 right-5 rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 backdrop-blur-xl">
          <p className="text-[10px] text-slate-400">Scroll · Drag · Click node · Hover to explore</p>
        </div>
      )}

      {/* ── Tooltip ───────────────────────────────────────────────────────── */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-20 max-w-[240px] rounded-2xl border border-slate-200/80 bg-white/95 px-3.5 py-3 text-xs shadow-xl backdrop-blur-2xl transition-opacity duration-100"
        style={{ opacity: tooltipNode ? 1 : 0 }}
      >
        {tooltipNode && (
          <>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: nodeColor(tooltipNode.type) }} />
              <p className="font-semibold text-slate-800">{tooltipNode.label}</p>
            </div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[9px] capitalize text-slate-500">
                {tooltipNode.type.replace(/_/g, " ")}
              </span>
              <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[9px] capitalize text-slate-500">
                {tooltipNode.importance}
              </span>
              <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[9px] text-slate-500">
                {hovConnectedRef.current.size} connections
              </span>
            </div>
            {tooltipNode.keywords.length > 0 && (
              <p className="text-[10px] text-slate-400">{tooltipNode.keywords.slice(0, 4).join(" · ")}</p>
            )}
            <p className="mt-1.5 text-[9px] text-slate-400">Click to open in editor</p>
          </>
        )}
      </div>
    </div>
  );
}

function ZoomBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
    >
      {children}
    </button>
  );
}
