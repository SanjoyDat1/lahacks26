"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";

import type { GraphData, GraphLink, GraphNode } from "@/lib/brian/reader";
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

/** Canvas px: drag this far from a node press to start a link; shorter motion keeps a click for selection. */
const LINK_DRAG_THRESHOLD_PX = 8;
const PAN_DRAG_THRESHOLD_PX = 4;
/** Radians: half the apex angle of link arrowheads (wings at ang ± this). */
const ARROW_HEAD_HALF_ANGLE = 0.42;

// ─── simulation ────────────────────────────────────────────────────────────────

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };
type SimLink = { source: SimNode; target: SimNode };

function initNodes(nodes: GraphNode[]): SimNode[] {
  // Seed on a wider ring so the simulation expands outward to fill space
  // rather than starting tightly bunched around the origin.
  const baseR = 240 + Math.min(180, nodes.length * 6);
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = baseR + Math.random() * 60;
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

/** Unordered endpoints so A→B and B→A share a bucket (visual overlap). */
function undirectedPairKey(a: string, b: string) {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Lane index per directed edge: 0 when this pair is the only link between the
 * two nodes; otherwise symmetric offsets so multiple links curve apart.
 * Topology is unchanged — layout-only.
 */
function buildLaneByDirectedKey(links: SimLink[]): Map<string, number> {
  const pairBuckets = new Map<string, SimLink[]>();
  for (const L of links) {
    const pk = undirectedPairKey(L.source.id, L.target.id);
    let arr = pairBuckets.get(pk);
    if (!arr) {
      arr = [];
      pairBuckets.set(pk, arr);
    }
    arr.push(L);
  }
  const laneByDirected = new Map<string, number>();
  for (const arr of pairBuckets.values()) {
    if (arr.length < 2) {
      for (const L of arr) laneByDirected.set(`${L.source.id}\0${L.target.id}`, 0);
      continue;
    }
    const sorted = [...arr].sort((a, b) =>
      `${a.source.id}\0${a.target.id}`.localeCompare(`${b.source.id}\0${b.target.id}`, "en"),
    );
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      laneByDirected.set(`${sorted[i]!.source.id}\0${sorted[i]!.target.id}`, i - (n - 1) / 2);
    }
  }
  return laneByDirected;
}

type LinkDrawGeom = {
  straight: boolean;
  p0x: number;
  p0y: number;
  cx: number;
  cy: number;
  lineEx: number;
  lineEy: number;
  ex: number;
  ey: number;
  /** Direction from stroke end toward arrow tip (same convention as straight chords). */
  ang: number;
};

function computeLinkDrawGeom(s: SimNode, t: SimNode, lane: number, arrowLen: number): LinkDrawGeom {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nr = nodeRadius(t.val);
  const headDepth = arrowLen * Math.cos(ARROW_HEAD_HALF_ANGLE);

  if (Math.abs(lane) < 1e-6) {
    const ang = Math.atan2(dy, dx);
    const ex = t.x - ux * (nr + 7);
    const ey = t.y - uy * (nr + 7);
    const lineEx = ex - headDepth * Math.cos(ang);
    const lineEy = ey - headDepth * Math.sin(ang);
    return { straight: true, p0x: s.x, p0y: s.y, cx: 0, cy: 0, lineEx, lineEy, ex, ey, ang };
  }

  const mx = (s.x + t.x) / 2;
  const my = (s.y + t.y) / 2;
  const nx = -uy;
  const ny = ux;
  const spread = lane * Math.min(len * 0.16, 52);
  const cx = mx + nx * spread;
  const cy = my + ny * spread;

  let ex = t.x - ux * (nr + 7);
  let ey = t.y - uy * (nr + 7);
  let lineEx = ex - headDepth * ux;
  let lineEy = ey - headDepth * uy;

  for (let iter = 0; iter < 2; iter++) {
    const tx = lineEx - cx;
    const ty = lineEy - cy;
    const tlen = Math.sqrt(tx * tx + ty * ty) || 1;
    const vx = tx / tlen;
    const vy = ty / tlen;
    ex = t.x - vx * (nr + 7);
    ey = t.y - vy * (nr + 7);
    lineEx = ex - headDepth * vx;
    lineEy = ey - headDepth * vy;
  }

  const ang = Math.atan2(ey - lineEy, ex - lineEx);
  return { straight: false, p0x: s.x, p0y: s.y, cx, cy, lineEx, lineEy, ex, ey, ang };
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const x = ax + u * dx;
  const y = ay + u * dy;
  return Math.hypot(px - x, py - y);
}

function distanceToQuadraticBezier(
  px: number,
  py: number,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  segments: number,
) {
  let minD = Infinity;
  let prevX = x0;
  let prevY = y0;
  for (let i = 1; i <= segments; i++) {
    const u = i / segments;
    const o = 1 - u;
    const x = o * o * x0 + 2 * o * u * cx + u * u * x1;
    const y = o * o * y0 + 2 * o * u * cy + u * u * y1;
    minD = Math.min(minD, distanceToSegment(px, py, prevX, prevY, x, y));
    prevX = x;
    prevY = y;
  }
  return minD;
}

const REPULSION = 14000;
const IDEAL_LEN = 220;
const SPRING = 0.010;
const GRAVITY = 0.0035;
const DAMP = 0.55;
const MAX_VEL = 6;

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
    // Cap per-frame velocity so a single big force can't fling a node
    if (n.vx > MAX_VEL) n.vx = MAX_VEL; else if (n.vx < -MAX_VEL) n.vx = -MAX_VEL;
    if (n.vy > MAX_VEL) n.vy = MAX_VEL; else if (n.vy < -MAX_VEL) n.vy = -MAX_VEL;
    n.x += n.vx; n.y += n.vy;
  }
}

// ─── update visualization state ───────────────────────────────────────────────

export type UpdateVisuState = {
  active: { path: string; kind: string; reason: string } | null;
  queued: Set<string>;
  done: Set<string>;
  totalOps: number;
  appliedOps: number;
};

// ─── component ─────────────────────────────────────────────────────────────────

interface Props {
  graphData: GraphData;
  onNodeSelect?: (node: GraphNode | null) => void;
  onEdgeSelect?: (edge: GraphLink | null) => void;
  /** Double-click a link to remove it (optional; parent runs DELETE + local graph update). */
  onEdgeDelete?: (edge: GraphLink) => void;
  onLinkCreate?: (sourceId: string, targetId: string) => Promise<void>;
  selectedId?: string;
  selectedEdge?: GraphLink | null;
  /** Briefly emphasize this edge after a successful link create (client-driven). */
  flashEdge?: GraphLink | null;
  highlightMap?: Map<string, Relevance>;
  updateVisu?: UpdateVisuState;
  visibleFilter?: (node: GraphNode) => boolean;
  colorOverride?: (node: GraphNode) => string;
  theme?: "light" | "dark";
  /**
   * Minimal chrome mode: hides labels, legend, zoom controls, and tooltip.
   * Nodes are dimmed by default and only brighten on hover/selection.
   */
  minimal?: boolean;
}

export function BrainGraph({
  graphData,
  onNodeSelect,
  onEdgeSelect,
  onEdgeDelete,
  onLinkCreate,
  selectedId,
  selectedEdge,
  flashEdge = null,
  highlightMap,
  updateVisu,
  visibleFilter,
  colorOverride,
  theme = "light",
  minimal = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const sizeRef = useRef({ w: 800, h: 600 });
  const dprRef = useRef(1);

  // Filter state (search moved out of this component into the prompt bar)
  const [filterType, setFilterType] = useState<string | null>(null);
  const filterTypeRef2 = useRef<string | null>(null);

  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const viewRef = useRef({ ox: 0, oy: 0, k: 1 });

  const hoverIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  const selectedEdgeRef = useRef<GraphLink | null | undefined>(selectedEdge);
  const flashEdgeRef = useRef<GraphLink | null>(null);
  /** Link under pointer (when not on a node / not panning / not link-dragging) — drives hover stroke in drawFrame. */
  const hoveredEdgeRef = useRef<GraphLink | null>(null);
  const draggingRef = useRef<SimNode | null>(null);
  const connectDragRef = useRef<{ source: SimNode; x: number; y: number } | null>(null);
  /** Press on node body — becomes a link drag after LINK_DRAG_PX movement (click still selects if you don't drag). */
  const connectAnchorRef = useRef<SimNode | null>(null);
  const connectTargetRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ mx: number; my: number; ox0: number; oy0: number } | null>(null);
  const mouseDownRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const [tooltipNode, setTooltipNode] = useState<SimNode | null>(null);
  const [hoverConnectionCount, setHoverConnectionCount] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  /** True when pointer is near a link (not a node) — custom cursor for “select / remove connection”. */
  const [edgeHovered, setEdgeHovered] = useState(false);
  const hoverNodeRef = useRef<SimNode | null>(null);
  // Connected node IDs for the currently hovered node
  const hovConnectedRef = useRef<Set<string>>(new Set());

  const highlightMapRef = useRef<Map<string, Relevance> | undefined>(highlightMap);
  const highlightAlphaRef = useRef(0);
  const updateVisuRef = useRef<UpdateVisuState | undefined>(updateVisu);
  const panTargetRef = useRef<{ x: number; y: number } | null>(null);
  /** When the visible node id set is unchanged, preserve positions and camera (e.g. new edge only). */
  const visibleNodeSetRef = useRef<string>("");

  const isDark = theme === "dark";

  // Zoom bounds — tighter floor in minimal mode so the graph can't be shrunk
  // into a tiny blob behind the side panels.
  const MIN_ZOOM = minimal ? 0.55 : 0.1;
  const MAX_ZOOM = 5;

  const filteredGraph = useMemo(() => {
    if (!visibleFilter) return graphData;
    const nodes = graphData.nodes.filter((n) => visibleFilter(n));
    const keep = new Set(nodes.map((n) => n.id));
    const links = graphData.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    return { nodes, links };
  }, [graphData, visibleFilter]);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { selectedEdgeRef.current = selectedEdge; }, [selectedEdge]);
  useEffect(() => {
    flashEdgeRef.current = flashEdge;
  }, [flashEdge]);
  useEffect(() => {
    highlightMapRef.current = highlightMap;
  }, [highlightMap]);

  useEffect(() => {
    updateVisuRef.current = updateVisu;
  }, [updateVisu]);
  // Pan camera to active update node
  useEffect(() => {
    if (updateVisu?.active) {
      const path = updateVisu.active.path;
      const node = nodesRef.current.find((n) => n.id === path || n.path === path);
      if (node) panTargetRef.current = { x: node.x, y: node.y };
    }
  }, [updateVisu?.active?.path]);
  useEffect(() => { filterTypeRef2.current = filterType; }, [filterType]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function applySize() {
      const w = el!.offsetWidth, h = el!.offsetHeight;
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      sizeRef.current = { w, h };
      dprRef.current = dpr;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      setSize({ w, h });
    }
    const ob = new ResizeObserver(applySize);
    ob.observe(el);
    applySize();
    const onDprChange = () => applySize();
    window.addEventListener("resize", onDprChange);
    return () => {
      ob.disconnect();
      window.removeEventListener("resize", onDprChange);
    };
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = dprRef.current;
    const { ox, oy, k } = viewRef.current;
    const hovId = hoverIdRef.current;
    const selId = selectedIdRef.current;
    const hmap = highlightMapRef.current;
    const searchQ = "";
    const fType = filterTypeRef2.current;
    const hovConnected = hovConnectedRef.current;
    const selEdge = selectedEdgeRef.current;
    const hovEdge = hoveredEdgeRef.current;
    const connectTarget = connectTargetRef.current;

    const uv = updateVisuRef.current;
    const inUpdateMode = !!uv && (!!uv.active || uv.done.size > 0 || uv.queued.size > 0);

    const targetHL = !inUpdateMode && hmap && hmap.size > 0 ? 1 : 0;
    highlightAlphaRef.current += (targetHL - highlightAlphaRef.current) * 0.07;
    const hl = highlightAlphaRef.current;

    const frameNowMs = Date.now();
    const pulse = Math.sin(frameNowMs / 420) * 0.5 + 0.5;
    const pulseFast = Math.sin(frameNowMs / 240) * 0.5 + 0.5;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + ox, h / 2 + oy);
    ctx.scale(k, k);

    const inHighlightMode = !inUpdateMode && hl > 0.1 && hmap && hmap.size > 0;
    const inSearchMode = !inUpdateMode && !inHighlightMode && (!!searchQ || !!fType);
    const inHoverMode = !inUpdateMode && !inHighlightMode && !!hovId;

    function nodeUpdateState(n: SimNode): "active" | "queued" | "done" | "none" {
      if (!inUpdateMode || !uv) return "none";
      if (uv.active && (n.id === uv.active.path || n.path === uv.active.path)) return "active";
      if (uv.done.has(n.id) || uv.done.has(n.path)) return "done";
      if (uv.queued.has(n.id) || uv.queued.has(n.path)) return "queued";
      return "none";
    }

    // Helper: does a node match current filters?
    function nodeMatches(n: SimNode): boolean {
      const matchesSearch = !searchQ || n.label.toLowerCase().includes(searchQ) || n.type.toLowerCase().includes(searchQ);
      const matchesFilter = !fType || n.type === fType;
      return matchesSearch && matchesFilter;
    }

    // ── links ────────────────────────────────────────────────────────────────
    const flashLink = flashEdgeRef.current;
    const laneByDirected = buildLaneByDirectedKey(linksRef.current);
    const alBase = 7 / k;

    for (const { source: s, target: t } of linksRef.current) {
      const lane = laneByDirected.get(`${s.id}\0${t.id}`) ?? 0;

      const sRel = hmap?.get(s.id);
      const tRel = hmap?.get(t.id);
      const bothHighlighted = hl > 0.1 && sRel && tRel;
      const isLinkedToHov = hovId && (s.id === hovId || t.id === hovId);
      const isLinkedToSel = selId && (s.id === selId || t.id === selId);
      const isSelectedEdge = !!selEdge && selEdge.source === s.id && selEdge.target === t.id;
      const isHoveredEdge = !!hovEdge && hovEdge.source === s.id && hovEdge.target === t.id;
      const isFlashEdge =
        !!flashLink && flashLink.source === s.id && flashLink.target === t.id;
      const sMatches = nodeMatches(s), tMatches = nodeMatches(t);
      const sUpdState = nodeUpdateState(s);
      const tUpdState = nodeUpdateState(t);

      let lineColor: string;
      let lineWidth: number;
      let arrowColor: string;

      if (isFlashEdge) {
        const flashPulse = 0.78 + Math.sin(frameNowMs / 100) * 0.22;
        lineColor = `rgba(5, 150, 105, ${flashPulse})`;
        lineWidth = 4.6 / k;
        arrowColor = `rgba(167, 243, 208, ${0.88 + 0.12 * flashPulse})`;
      } else if (isSelectedEdge) {
        lineColor = "#8b5cf6";
        lineWidth = 3 / k;
        arrowColor = "#8b5cf6";
      } else if (isHoveredEdge && !inUpdateMode) {
        lineColor = minimal ? "#ddd6fe" : "#c4b5fd";
        lineWidth = 3.2 / k;
        arrowColor = minimal ? "#e9d5ff" : "#a78bfa";
      } else if (inUpdateMode) {
        const sActive = sUpdState === "active", tActive = tUpdState === "active";
        const sDone = sUpdState === "done", tDone = tUpdState === "done";
        if (sActive || tActive) {
          lineColor = `#f59e0bAA`;
          lineWidth = 2 / k;
          arrowColor = `#f59e0b77`;
        } else if (sDone && tDone) {
          lineColor = `#10b98166`;
          lineWidth = 1.2 / k;
          arrowColor = `#10b98144`;
        } else if (sDone || tDone) {
          lineColor = `#10b98133`;
          lineWidth = 0.8 / k;
          arrowColor = `#10b98122`;
        } else {
          lineColor = `rgba(100,116,139,0.04)`;
          lineWidth = 0.4 / k;
          arrowColor = `rgba(100,116,139,0.02)`;
        }
      } else if (bothHighlighted) {
        const bright = sRel === "primary" && tRel === "primary";
        const base = colorOverride ? colorOverride(s) : nodeColor(s.type);
        lineColor = base + (bright ? "CC" : "77");
        lineWidth = (bright ? 2 : 1.2) / k;
        arrowColor = base + (bright ? "AA" : "55");
      } else if (inHoverMode && isLinkedToHov) {
        const base = colorOverride ? colorOverride(s) : nodeColor(s.type);
        lineColor = minimal ? base + "F0" : base + "EE";
        lineWidth = minimal ? 3.1 / k : 2.85 / k;
        arrowColor = minimal ? base + "FA" : base + "F0";
      } else if (inHoverMode && !isLinkedToHov) {
        lineColor = `rgba(100,116,139,0.04)`;
        lineWidth = 0.4 / k;
        arrowColor = `rgba(100,116,139,0.03)`;
      } else if (inSearchMode && (!sMatches || !tMatches)) {
        lineColor = `rgba(100,116,139,0.04)`;
        lineWidth = 0.4 / k;
        arrowColor = `rgba(100,116,139,0.03)`;
      } else if (!inHighlightMode && (isLinkedToSel)) {
        const base = colorOverride ? colorOverride(s) : nodeColor(s.type);
        lineColor = base + "99";
        lineWidth = 1.4 / k;
        arrowColor = base + "66";
      } else {
        const dimFactor = 1 - hl * 0.82;
        if (minimal) {
          // Subtle idle links/arrows against dark canvas — readable but not loud
          const lineA = Math.round(0.18 * dimFactor * 255).toString(16).padStart(2, "0");
          const arrowA = Math.round(0.28 * dimFactor * 255).toString(16).padStart(2, "0");
          lineColor = `#a78bfa${lineA}`;
          arrowColor = `#a78bfa${arrowA}`;
          lineWidth = 0.7 / k;
        } else {
          const a = Math.round(0.13 * dimFactor * 255).toString(16).padStart(2, "0");
          lineColor = `#64748b${a}`;
          lineWidth = 0.8 / k;
          arrowColor = `#64748b${a}`;
        }
      }

      let arrowLen = alBase;
      if (isFlashEdge) {
        arrowLen = 12 / k;
      } else if (inHoverMode && isLinkedToHov && !isSelectedEdge && !inUpdateMode) {
        arrowLen = (minimal ? 10.5 : 9.5) / k;
      } else if (isHoveredEdge && !isSelectedEdge && !inUpdateMode) {
        arrowLen = (minimal ? 10.5 : 9.5) / k;
      }

      const { straight, p0x, p0y, cx, cy, lineEx, lineEy, ex, ey, ang } = computeLinkDrawGeom(
        s,
        t,
        lane,
        arrowLen,
      );

      ctx.beginPath();
      ctx.moveTo(p0x, p0y);
      if (straight) ctx.lineTo(lineEx, lineEy);
      else ctx.quadraticCurveTo(cx, cy, lineEx, lineEy);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "butt";
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(
        ex - arrowLen * Math.cos(ang - ARROW_HEAD_HALF_ANGLE),
        ey - arrowLen * Math.sin(ang - ARROW_HEAD_HALF_ANGLE),
      );
      ctx.lineTo(
        ex - arrowLen * Math.cos(ang + ARROW_HEAD_HALF_ANGLE),
        ey - arrowLen * Math.sin(ang + ARROW_HEAD_HALF_ANGLE),
      );
      ctx.closePath();
      ctx.fillStyle = arrowColor;
      ctx.fill();
    }

    const pending = connectDragRef.current;
    if (pending) {
      const target = connectTarget && connectTarget.id !== pending.source.id ? connectTarget : null;
      const endX = target?.x ?? pending.x;
      const endY = target?.y ?? pending.y;
      const midX = (pending.source.x + endX) / 2;
      const sourceColor = colorOverride ? colorOverride(pending.source) : nodeColor(pending.source.type);
      ctx.beginPath();
      ctx.moveTo(pending.source.x, pending.source.y);
      ctx.bezierCurveTo(midX, pending.source.y - 45 / k, midX, endY + 45 / k, endX, endY);
      ctx.strokeStyle = target ? "#10b981" : sourceColor;
      ctx.lineWidth = (target ? 3 : 2.2) / k;
      ctx.setLineDash([8 / k, 6 / k]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pending.source.x, pending.source.y, nodeRadius(pending.source.val) + 12 / k, 0, Math.PI * 2);
      ctx.strokeStyle = `${sourceColor}88`;
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(endX, endY, (target ? nodeRadius(target.val) + 14 : 7) / k, 0, Math.PI * 2);
      ctx.fillStyle = target ? "rgba(16,185,129,0.14)" : "rgba(139,92,246,0.18)";
      ctx.fill();
      ctx.strokeStyle = target ? "#10b981" : "#8b5cf6";
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
    }

    // ── nodes ────────────────────────────────────────────────────────────────
    for (const n of nodesRef.current) {
      const r = nodeRadius(n.val);
      const c = colorOverride ? colorOverride(n) : nodeColor(n.type);
      const isHov = hovId === n.id;
      const isSel = selId === n.id;
      const isConnectTarget = connectTarget?.id === n.id;
      const relevance = hmap?.get(n.id) ?? hmap?.get(n.path);
      const matches = nodeMatches(n);
      const isConnectedToHov = hovConnected.has(n.id);
      const updState = nodeUpdateState(n);

      // ── Opacity ──────────────────────────────────────────────────────────
      let opacity: number;
      if (inUpdateMode) {
        opacity = updState === "active" ? 1 : updState === "done" ? 0.88 : updState === "queued" ? 0.55 : 0.08;
      } else if (inHighlightMode) {
        opacity = relevance ? 1 : Math.max(0.08, 0.2 - hl * 0.15);
      } else if (inSearchMode && !matches) {
        opacity = 0.1;
      } else if (inHoverMode && !isHov && !isConnectedToHov) {
        opacity = 0.3;
      } else if (minimal && !isHov && !isSel && !isConnectedToHov) {
        opacity = isDark ? 0.32 : 0.6;
      } else {
        opacity = 1;
      }

      ctx.globalAlpha = opacity;

      // ── Update-mode glows ────────────────────────────────────────────────
      if (inUpdateMode) {
        if (updState === "active") {
          // Outer diffuse amber glow
          const glowR = r + (22 + pulseFast * 14) / k;
          const grd = ctx.createRadialGradient(n.x, n.y, r * 0.6, n.x, n.y, glowR);
          grd.addColorStop(0, `#f59e0b${Math.round((0.45 + pulseFast * 0.3) * 255).toString(16).padStart(2, "0")}`);
          grd.addColorStop(0.5, `#f59e0b22`);
          grd.addColorStop(1, `#f59e0b00`);
          ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd; ctx.fill();
          // Inner ring
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + (5 + pulseFast * 6) / k, 0, Math.PI * 2);
          ctx.strokeStyle = `#f59e0b${Math.round((0.85 + pulseFast * 0.15) * 255).toString(16).padStart(2, "0")}`;
          ctx.lineWidth = (2 + pulseFast * 1.5) / k;
          ctx.stroke();
          // Outer ring
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + (12 + pulseFast * 10) / k, 0, Math.PI * 2);
          ctx.strokeStyle = `#f59e0b${Math.round((0.35 + pulseFast * 0.25) * 255).toString(16).padStart(2, "0")}`;
          ctx.lineWidth = (1.2 + pulseFast) / k;
          ctx.stroke();
        } else if (updState === "done") {
          // Soft emerald glow
          const glowR = r + 14 / k;
          const grd = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, glowR);
          grd.addColorStop(0, `#10b98155`); grd.addColorStop(1, `#10b98100`);
          ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grd; ctx.fill();
          // Thin solid ring
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3 / k, 0, Math.PI * 2);
          ctx.strokeStyle = `#10b981BB`;
          ctx.lineWidth = 1.5 / k;
          ctx.stroke();
        } else if (updState === "queued") {
          // Dashed violet ring (waiting to be processed)
          ctx.beginPath();
          ctx.setLineDash([4 / k, 3 / k]);
          ctx.arc(n.x, n.y, r + (4 + pulse * 2) / k, 0, Math.PI * 2);
          ctx.strokeStyle = `#8b5cf677`;
          ctx.lineWidth = 1.5 / k;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      // ── Normal-mode glows ─────────────────────────────────────────────────
      } else if (relevance === "primary" && inHighlightMode) {
        const glowR = r + (14 + pulse * 12) / k;
        const grd = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, glowR);
        grd.addColorStop(0, `${c}${Math.round((0.35 + pulse * 0.3) * 255).toString(16).padStart(2, "0")}`);
        grd.addColorStop(1, `${c}00`);
        ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
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
      } else if ((isHov || isSel || isConnectedToHov || isConnectTarget) && !inHighlightMode) {
        const glowSize = isConnectTarget ? 28 : isHov ? 22 : isConnectedToHov ? 14 : 18;
        const grd = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r + glowSize / k);
        grd.addColorStop(0, `${isConnectTarget ? "#10b981" : c}44`); grd.addColorStop(1, `${c}00`);
        ctx.beginPath(); ctx.arc(n.x, n.y, r + glowSize / k, 0, Math.PI * 2);
        ctx.fillStyle = grd; ctx.fill();
      }

      // ── Node fill ────────────────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (inUpdateMode) {
        if (updState === "active") ctx.fillStyle = c;
        else if (updState === "done") ctx.fillStyle = `#10b981`;
        else if (updState === "queued") ctx.fillStyle = `${c}88`;
        else ctx.fillStyle = `${c}22`;
      } else {
        const brightFill = (inHighlightMode && relevance) || isHov || isSel || isConnectedToHov;
        ctx.fillStyle = brightFill ? c : `${c}BB`;
      }
      ctx.fill();

      // ── Node stroke ──────────────────────────────────────────────────────
      if (inUpdateMode) {
        if (updState === "active") {
          ctx.strokeStyle = `#f59e0b`;
          ctx.lineWidth = 2.5 / k;
        } else if (updState === "done") {
          ctx.strokeStyle = `#10b981CC`;
          ctx.lineWidth = 2 / k;
        } else if (updState === "queued") {
          ctx.strokeStyle = `#8b5cf655`;
          ctx.lineWidth = 1 / k;
        } else {
          ctx.strokeStyle = `rgba(15,23,42,0.06)`;
          ctx.lineWidth = 0.6 / k;
        }
      } else {
        const strongBorder = isSel || isConnectTarget || (relevance === "primary" && hl > 0.5);
        ctx.strokeStyle = isConnectTarget ? "rgba(16,185,129,0.95)" : strongBorder ? "rgba(139,92,246,0.85)" : "rgba(15,23,42,0.12)";
        ctx.lineWidth = (strongBorder ? 2.8 : 0.8) / k;
      }
      ctx.stroke();

      // ── Hover ring (normal mode) ─────────────────────────────────────────
      if (!inUpdateMode && isHov) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (3 + pulse * 2) / k, 0, Math.PI * 2);
        ctx.strokeStyle = `${c}${Math.round((0.6 + pulse * 0.3) * 255).toString(16).padStart(2, "0")}`;
        ctx.lineWidth = (1.5 + pulse) / k;
        ctx.stroke();
      }
      if (!inUpdateMode && (isHov || isSel) && k > 0.25) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + (2 + pulse * 1.5) / k, 0, Math.PI * 2);
        ctx.setLineDash([3 / k, 3 / k]);
        ctx.strokeStyle = `${c}55`;
        ctx.lineWidth = 1 / k;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;

      // ── Label ────────────────────────────────────────────────────────────
      if (k >= 0.25) {
        let labelOpacity: number;
        if (inUpdateMode) {
          labelOpacity = updState === "active" ? 1 : updState === "done" ? 0.9 : updState === "queued" ? 0.5 : 0.05;
        } else if (minimal) {
          // In minimal mode keep idle labels very subtle so the canvas reads as
          // a graph of nodes, not a wall of text. Selected / hovered / connected
          // labels pop at full opacity.
          labelOpacity = isSel ? 1
            : isHov ? 0.95
            : isConnectedToHov ? 0.7
            : inHoverMode ? 0.12
            : 0.42;
        } else {
          labelOpacity = inHighlightMode
            ? relevance === "primary" ? 1 : relevance === "secondary" ? 0.8 : relevance === "referenced" ? 0.55 : opacity
            : inSearchMode && !matches ? 0.1
            : inHoverMode && !isHov && !isConnectedToHov ? 0.2
            : (isHov || isSel ? 1 : 0.75);
        }
        ctx.globalAlpha = labelOpacity;
        const isFocused = isSel || isHov;
        const isBold = inUpdateMode ? updState === "active" : (relevance === "primary" || isFocused);
        // Smaller idle text in minimal mode, larger when focused.
        const fontPx = minimal
          ? (isSel ? 13 : isHov ? 12 : 9)
          : 11;
        ctx.font = `${isBold ? "600 " : ""}${fontPx}px -apple-system,BlinkMacSystemFont,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        if (inUpdateMode) {
          ctx.fillStyle = updState === "active" ? "#f59e0b" : updState === "done" ? "#059669" : "#64748b";
        } else if (minimal) {
          ctx.fillStyle = isDark
            ? (isFocused ? "#f8fafc" : "#cbd5e1")
            : (isFocused ? "#0f172a" : "#475569");
        } else {
          ctx.fillStyle = isFocused || relevance === "primary" ? "#0f172a" : "#64748b";
        }
        const maxLen = minimal && !isFocused ? 18 : 22;
        const lbl = n.label.length > maxLen ? n.label.slice(0, maxLen - 1) + "…" : n.label;
        ctx.fillText(lbl, n.x, n.y + r + 4 / k);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();

    // Imperatively update tooltip position
    if (hoverNodeRef.current && tooltipRef.current && !connectDragRef.current) {
      const n = hoverNodeRef.current;
      const screenX = w / 2 + ox + n.x * k;
      const screenY = h / 2 + oy + n.y * k;
      const placeLeft = screenX > w - 300;
      const cx = placeLeft ? screenX - 280 : screenX + 34;
      const cy = Math.max(16, Math.min(h - 150, screenY + 28));
      tooltipRef.current.style.left = `${cx}px`;
      tooltipRef.current.style.top = `${cy}px`;
    }
  }, []);

  // ── init & animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (!filteredGraph.nodes.length) return;
    const nodeKey = [...filteredGraph.nodes].map((n) => n.id).sort().join("\0");

    if (visibleNodeSetRef.current !== nodeKey) {
      visibleNodeSetRef.current = nodeKey;
      nodesRef.current = initNodes(filteredGraph.nodes);
      linksRef.current = buildLinks(nodesRef.current, filteredGraph.links);
      alphaRef.current = 1;
      viewRef.current = { ox: 0, oy: 0, k: 1 };
    } else {
      const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
      nodesRef.current = filteredGraph.nodes.map((gn) => {
        const o = byId.get(gn.id);
        if (o) return { ...gn, x: o.x, y: o.y, vx: o.vx, vy: o.vy };
        return initNodes([gn])[0]!;
      });
      linksRef.current = buildLinks(nodesRef.current, filteredGraph.links);
      alphaRef.current = Math.max(alphaRef.current, 0.18);
    }
    cancelAnimationFrame(rafRef.current);

    function frame() {
      if (alphaRef.current > 0.004) {
        alphaRef.current *= 0.94;
        tick(nodesRef.current, linksRef.current, alphaRef.current);
      }
      // Smooth camera pan to active update node
      if (panTargetRef.current) {
        const { x: tx, y: ty } = panTargetRef.current;
        const { k } = viewRef.current;
        const targetOx = -tx * k;
        const targetOy = -ty * k;
        viewRef.current.ox += (targetOx - viewRef.current.ox) * 0.06;
        viewRef.current.oy += (targetOy - viewRef.current.oy) * 0.06;
        if (Math.abs(targetOx - viewRef.current.ox) < 0.5 && Math.abs(targetOy - viewRef.current.oy) < 0.5) {
          panTargetRef.current = null;
        }
      }
      drawFrame();
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [filteredGraph, drawFrame]);

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

  function findLink(cx: number, cy: number): GraphLink | null {
    const sim = toSim(cx, cy);
    const { k } = viewRef.current;
    const threshold = 8 / k;
    const lanes = buildLaneByDirectedKey(linksRef.current);
    const arrowLenHit = 7 / k;
    let best: GraphLink | null = null;
    let bestD = threshold;
    for (const link of linksRef.current) {
      const lane = lanes.get(`${link.source.id}\0${link.target.id}`) ?? 0;
      const g = computeLinkDrawGeom(link.source, link.target, lane, arrowLenHit);
      const d = g.straight
        ? distanceToSegment(sim.x, sim.y, g.p0x, g.p0y, g.lineEx, g.lineEy)
        : distanceToQuadraticBezier(sim.x, sim.y, g.p0x, g.p0y, g.cx, g.cy, g.lineEx, g.lineEy, 32);
      if (d < bestD) {
        bestD = d;
        best = { source: link.source.id, target: link.target.id };
      }
    }
    return best;
  }

  // ── event handlers ─────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    mouseDownRef.current = { x: cx, y: cy, moved: false };
    connectAnchorRef.current = null;

    if (onLinkCreate) {
      const bodyNode = findNode(cx, cy);
      if (bodyNode) {
        connectAnchorRef.current = bodyNode;
        return;
      }
    }

    const { ox, oy } = viewRef.current;
    panRef.current = { mx: cx, my: cy, ox0: ox, oy0: oy };
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    const dragDist =
      mouseDownRef.current ? Math.hypot(cx - mouseDownRef.current.x, cy - mouseDownRef.current.y) : 0;

    if (connectAnchorRef.current && !connectDragRef.current && onLinkCreate && dragDist > LINK_DRAG_THRESHOLD_PX) {
      const src = connectAnchorRef.current;
      connectAnchorRef.current = null;
      const sim = toSim(cx, cy);
      connectDragRef.current = { source: src, x: sim.x, y: sim.y };
      const target = findNode(cx, cy);
      connectTargetRef.current = target && target.id !== src.id ? target : null;
      alphaRef.current = Math.max(alphaRef.current, 0.25);
      if (!isConnecting) setIsConnecting(true);
    }

    if (mouseDownRef.current) {
      if (panRef.current && dragDist > PAN_DRAG_THRESHOLD_PX) mouseDownRef.current.moved = true;
      if (connectDragRef.current && dragDist > PAN_DRAG_THRESHOLD_PX) mouseDownRef.current.moved = true;
    }

    if (connectDragRef.current) {
      const sim = toSim(cx, cy);
      connectDragRef.current.x = sim.x;
      connectDragRef.current.y = sim.y;
      const target = findNode(cx, cy);
      connectTargetRef.current = target && target.id !== connectDragRef.current.source.id ? target : null;
    } else if (panRef.current) {
      const { mx, my, ox0, oy0 } = panRef.current;
      viewRef.current = { ...viewRef.current, ox: ox0 + (cx - mx), oy: oy0 + (cy - my) };
    }

    const nextHoverNode = connectDragRef.current ? null : findNode(cx, cy);
    if (nextHoverNode?.id !== hoverIdRef.current) {
      hoverIdRef.current = nextHoverNode?.id ?? null;
      hoverNodeRef.current = nextHoverNode;
      // Compute connected nodes for hover glow
      if (nextHoverNode) {
        const connected = new Set<string>();
        for (const link of linksRef.current) {
          if (link.source.id === nextHoverNode.id) connected.add(link.target.id);
          if (link.target.id === nextHoverNode.id) connected.add(link.source.id);
        }
        hovConnectedRef.current = connected;
        setHoverConnectionCount(connected.size);
      } else {
        hovConnectedRef.current = new Set();
        setHoverConnectionCount(0);
      }
      setTooltipNode(nextHoverNode);
    }

    const linkAt =
      !connectDragRef.current && !panRef.current && !nextHoverNode ? findLink(cx, cy) : null;
    hoveredEdgeRef.current = linkAt;
    const overLink = linkAt !== null;
    setEdgeHovered((prev) => (prev === overLink ? prev : overLink));
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (connectDragRef.current) {
      const source = connectDragRef.current.source;
      const target = connectTargetRef.current ?? findNode(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
      if (target && target.id !== source.id) {
        void onLinkCreate?.(source.id, target.id);
      }
      connectDragRef.current = null;
      connectTargetRef.current = null;
      setIsConnecting(false);
    }
    connectAnchorRef.current = null;
    panRef.current = null;
  }

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mouseDownRef.current?.moved) return;
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    const node = findNode(cx, cy);
    if (node) {
      onEdgeSelect?.(null);
      onNodeSelect?.(node);
      return;
    }
    const link = findLink(cx, cy);
    if (link) {
      onNodeSelect?.(null);
      onEdgeSelect?.(link);
      return;
    }
    onNodeSelect?.(null);
    onEdgeSelect?.(null);
  }

  function onDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onEdgeDelete) return;
    if (mouseDownRef.current?.moved) return;
    const cx = e.nativeEvent.offsetX, cy = e.nativeEvent.offsetY;
    if (findNode(cx, cy)) return;
    const link = findLink(cx, cy);
    if (link) {
      onNodeSelect?.(null);
      onEdgeSelect?.(null);
      onEdgeDelete(link);
    }
  }

  // Native non-passive wheel listener so we can actually preventDefault the
  // browser's pinch-zoom / Ctrl+wheel gesture and route it into the graph
  // zoom instead. (React's synthetic onWheel is registered as passive.)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.88;
      const cx = e.offsetX, cy = e.offsetY;
      const { w, h } = sizeRef.current;
      const { ox, oy, k } = viewRef.current;
      const simX = (cx - w / 2 - ox) / k;
      const simY = (cy - h / 2 - oy) / k;
      const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor));
      viewRef.current = { k: newK, ox: cx - w / 2 - simX * newK, oy: cy - h / 2 - simY * newK };
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [MIN_ZOOM, MAX_ZOOM]);

  function zoomBy(factor: number) {
    const { w, h } = sizeRef.current;
    const { ox, oy, k } = viewRef.current;
    const cx = w / 2, cy = h / 2;
    const simX = (cx - w / 2 - ox) / k;
    const simY = (cy - h / 2 - oy) / k;
    const newK = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor));
    viewRef.current = { k: newK, ox: cx - w / 2 - simX * newK, oy: cy - h / 2 - simY * newK };
  }

  function resetView() {
    viewRef.current = { ox: 0, oy: 0, k: 1 };
  }

  const uniqueTypes = [...new Set(filteredGraph.nodes.map((n) => n.type))];

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={cn(
          "block h-full w-full",
          isConnecting
            ? "cursor-crosshair"
            : tooltipNode
              ? "cursor-pointer"
              : edgeHovered
                ? "cursor-brain-edge"
                : "cursor-grab active:cursor-grabbing",
        )}
        style={{
          background: minimal
            ? "transparent"
            : isDark
              ? "transparent"
              : "radial-gradient(ellipse at 50% 25%, #dbeafe 0%, #eff6ff 55%, #f5f3ff 100%)",
        }}
        suppressHydrationWarning
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          draggingRef.current = null;
          connectDragRef.current = null;
          connectAnchorRef.current = null;
          connectTargetRef.current = null;
          setIsConnecting(false);
          setEdgeHovered(false);
          hoveredEdgeRef.current = null;
          panRef.current = null;
          mouseDownRef.current = null;
          hoverIdRef.current = null;
          hoverNodeRef.current = null;
          hovConnectedRef.current = new Set();
          setHoverConnectionCount(0);
          setTooltipNode(null);
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />

      {/* ── Active type filter chip ───────────────────────────────────────── */}
      {filterType && (
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-2xl border border-white/80 bg-white/90 px-3 py-2 shadow-sm backdrop-blur-2xl">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: nodeColor(filterType) }} />
            <span className="text-xs font-medium capitalize text-slate-600">{filterType.replace(/_/g, " ")}</span>
            <button onClick={() => setFilterType(null)} className="ml-1 text-slate-400 hover:text-slate-600">
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* ── Legend (clickable type filter) ────────────────────────────────── */}
      {!minimal && (
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
      )}

      {/* ── Zoom controls ─────────────────────────────────────────────────── */}
      {!minimal && (
      <div className="absolute bottom-5 right-5 flex flex-col gap-1 rounded-2xl border border-white/80 bg-white/85 p-1.5 shadow-md backdrop-blur-2xl">
        <ZoomBtn onClick={() => zoomBy(1.3)} title="Zoom in"><Plus size={13} /></ZoomBtn>
        <ZoomBtn onClick={resetView} title="Reset view"><RotateCcw size={12} /></ZoomBtn>
        <ZoomBtn onClick={() => zoomBy(0.77)} title="Zoom out"><Minus size={13} /></ZoomBtn>
      </div>
      )}

      {/* ── Connect drag help ─────────────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-2xl border border-violet-200/70 bg-white/90 px-4 py-2 text-xs font-medium text-violet-700 shadow-lg shadow-violet-100/60 backdrop-blur-2xl transition-opacity duration-200"
        style={{ opacity: isConnecting ? 1 : 0 }}
      >
        Drop on another node to link context
      </div>

      {/* ── Update visualization overlay ───────────────────────────────────── */}
      {updateVisu && (updateVisu.active || updateVisu.done.size > 0 || updateVisu.queued.size > 0) && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 w-[360px]">
          {/* Progress bar */}
          <div className="mb-2 flex items-center gap-2 rounded-2xl border border-white/80 bg-white/90 px-4 py-2 shadow-lg backdrop-blur-2xl">
            <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-1.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-700"
                style={{ width: `${updateVisu.totalOps ? (updateVisu.appliedOps / updateVisu.totalOps) * 100 : 0}%` }}
              />
            </div>
            <span className="flex-shrink-0 text-[10px] font-semibold tabular-nums text-slate-500">
              {updateVisu.appliedOps} / {updateVisu.totalOps}
            </span>
          </div>

          {/* Active op card */}
          {updateVisu.active && (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-50/95 px-4 py-3 shadow-xl shadow-amber-100/60 backdrop-blur-2xl">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={cn(
                  "rounded-lg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                  updateVisu.active.kind === "append" ? "bg-blue-100 text-blue-700" :
                  updateVisu.active.kind === "supersede" ? "bg-amber-100 text-amber-700" :
                  updateVisu.active.kind === "create_section" ? "bg-violet-100 text-violet-700" :
                  updateVisu.active.kind === "flag_conflict" ? "bg-red-100 text-red-700" :
                  "bg-slate-100 text-slate-600"
                )}>
                  {updateVisu.active.kind.replace("_", " ")}
                </span>
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] font-semibold text-amber-700">Applying now</span>
              </div>
              <p className="font-mono text-[10px] font-semibold text-slate-700 truncate mb-1">
                {updateVisu.active.path}
              </p>
              <p className="text-[10px] leading-4 text-slate-500 line-clamp-2">
                {updateVisu.active.reason}
              </p>
            </div>
          )}

          {/* Queue indicator */}
          {updateVisu.queued.size > 0 && !updateVisu.active && (
            <div className="rounded-2xl border border-violet-200/60 bg-violet-50/90 px-4 py-2.5 shadow-md backdrop-blur-2xl">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {Array.from({ length: Math.min(5, updateVisu.queued.size) }).map((_, i) => (
                    <div key={i} className="h-1.5 w-1.5 rounded-full bg-violet-400 opacity-70" style={{ animationDelay: `${i * 0.12}s` }} />
                  ))}
                </div>
                <span className="text-[10px] font-medium text-violet-600">
                  {updateVisu.queued.size} operation{updateVisu.queued.size === 1 ? "" : "s"} queued
                </span>
              </div>
            </div>
          )}

          {/* Done state */}
          {!updateVisu.active && updateVisu.queued.size === 0 && updateVisu.done.size > 0 && (
            <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/90 px-4 py-2.5 shadow-md backdrop-blur-2xl">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-semibold text-emerald-700">
                  {updateVisu.done.size} file{updateVisu.done.size === 1 ? "" : "s"} updated — refreshing brain...
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Hover tip ─────────────────────────────────────────────────────── */}
      {!minimal && !tooltipNode && (
        <div className="pointer-events-none absolute bottom-20 right-5 rounded-xl border border-white/70 bg-white/70 px-3 py-1.5 backdrop-blur-xl">
          <p className="text-[10px] text-slate-400">Scroll to zoom · Drag node to link · Click node to inspect · Click edge to edit</p>
        </div>
      )}

      {/* ── Tooltip ───────────────────────────────────────────────────────── */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-[25] max-w-[240px] rounded-2xl border border-slate-200/80 bg-white/95 px-3.5 py-3 text-xs shadow-xl backdrop-blur-2xl transition-opacity duration-100"
        style={{ opacity: tooltipNode ? 1 : 0 }}
      >
        {tooltipNode && (
          <>
            <p className="mb-1.5 font-semibold text-slate-800">{tooltipNode.label}</p>
            <div className="flex flex-wrap gap-1 mb-1.5">
              <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[9px] capitalize text-slate-500">
                {tooltipNode.type.replace(/_/g, " ")}
              </span>
              <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[9px] capitalize text-slate-500">
                {tooltipNode.importance}
              </span>
              <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[9px] text-slate-500">
                {hoverConnectionCount} connections
              </span>
            </div>
            {tooltipNode.keywords.length > 0 && (
              <p className="text-[10px] text-slate-400">{tooltipNode.keywords.slice(0, 4).join(" · ")}</p>
            )}
            <p className="mt-1.5 text-[9px] text-slate-400">Click to inspect · drag to connect</p>
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
