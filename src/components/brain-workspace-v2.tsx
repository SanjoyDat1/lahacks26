"use client";

import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Network,
  TrendingUp,
  Zap,
} from "lucide-react";

import { BrainAgentSim } from "@/components/brain-agent-sim";
import { BrainChat } from "@/components/brain-chat";
import { BrainGraph } from "@/components/brain-graph";
import type { BrianFile, GraphData, GraphNode } from "@/lib/brian/reader";
import type { Relevance } from "@/lib/brian/scenarios";
import { cn } from "@/lib/utils";

// ─── type-to-style maps ─────────────────────────────────────────────────────

const TYPE_DOT: Record<string, string> = {
  index: "bg-amber-400",
  architecture: "bg-blue-400",
  decision: "bg-red-400",
  decision_log: "bg-red-400",
  integration: "bg-green-400",
  agent_prompt: "bg-purple-400",
  summary: "bg-cyan-400",
  context: "bg-slate-400",
  goals: "bg-pink-400",
  map: "bg-orange-400",
};

const TYPE_BAR: Record<string, string> = {
  index: "from-amber-400 to-amber-300",
  architecture: "from-blue-500 to-blue-400",
  decision: "from-red-500 to-red-400",
  decision_log: "from-red-500 to-red-400",
  integration: "from-green-500 to-green-400",
  agent_prompt: "from-purple-500 to-purple-400",
  summary: "from-cyan-500 to-cyan-400",
  context: "from-slate-400 to-slate-300",
  goals: "from-pink-500 to-pink-400",
  map: "from-orange-500 to-orange-400",
};

function typeDot(type?: string) {
  return TYPE_DOT[type ?? ""] ?? "bg-slate-400";
}

function typeBar(type?: string) {
  return TYPE_BAR[type ?? ""] ?? "from-slate-400 to-slate-300";
}

function importanceBadge(imp?: string) {
  if (imp === "critical") return "border-red-300/60 text-red-600 bg-red-50/80";
  if (imp === "high") return "border-amber-300/60 text-amber-600 bg-amber-50/80";
  if (imp === "medium") return "border-sky-300/60 text-sky-600 bg-sky-50/80";
  return "border-slate-200/60 text-slate-400 bg-slate-50/60";
}

// ─── main component ──────────────────────────────────────────────────────────

type Tab = "graph" | "editor" | "overview" | "agent";

interface Props {
  files: BrianFile[];
  graphData: GraphData;
}

export function BrainWorkspaceV2({ files, graphData }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("graph");
  const [selectedFile, setSelectedFile] = useState<BrianFile | null>(
    files.find((f) => f.frontmatter.importance === "critical") ?? files[0] ?? null,
  );
  const [showPreview, setShowPreview] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [highlightMap, setHighlightMap] = useState<Map<string, Relevance> | undefined>();

  const handleHighlightChange = useCallback(
    (map: Map<string, Relevance> | undefined) => setHighlightMap(map),
    [],
  );

  function openFile(file: BrianFile, tab?: Tab) {
    setSelectedFile(file);
    setActiveTab(tab ?? "editor");
    setShowPreview(true);
  }

  function handleNodeSelect(node: GraphNode | null) {
    if (!node) return;
    const f = files.find(
      (file) => file.frontmatter.id === node.id || file.path === node.path,
    );
    if (f) openFile(f);
  }

  const grouped = groupByFolder(files);
  const selectedId =
    selectedFile?.frontmatter.id ?? selectedFile?.path ?? undefined;

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden">
      {/* ── Left sidebar ────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col border-r border-slate-200/60 transition-all duration-300 ease-out",
          "bg-white/60 backdrop-blur-2xl",
          leftOpen ? "w-56 min-w-56" : "w-0 min-w-0 overflow-hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200/50 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.5)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Brian
            </span>
          </div>
          <button
            onClick={() => setLeftOpen(false)}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100/70 hover:text-slate-600"
          >
            <ChevronLeft size={12} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2 pr-1">
          {Object.entries(grouped).map(([folder, folderFiles]) => (
            <div key={folder} className="mb-1">
              {folder !== "_root" && (
                <p className="px-4 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {folder}
                </p>
              )}
              {folderFiles.map((file) => {
                const name =
                  file.path.split("/").pop()?.replace(".md", "").replace(/_/g, " ") ??
                  file.path;
                const active = selectedFile?.path === file.path;
                return (
                  <button
                    key={file.path}
                    onClick={() => openFile(file)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-3 py-1.5 mx-1 text-xs transition-all duration-150",
                      active
                        ? "bg-violet-100/80 text-violet-700 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.2)]"
                        : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-800",
                    )}
                    style={{ width: "calc(100% - 8px)" }}
                  >
                    <div className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", typeDot(file.frontmatter.type))} />
                    <span className="truncate capitalize">{name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* collapse toggle (left closed) */}
      {!leftOpen && (
        <button
          onClick={() => setLeftOpen(true)}
          className="flex items-center justify-center border-r border-slate-200/60 bg-white/50 px-1.5 backdrop-blur-xl transition-colors hover:bg-white/70"
        >
          <ChevronRight size={12} className="text-slate-400" />
        </button>
      )}

      {/* ── Center ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-slate-200/60 bg-white/50 px-3 py-2 backdrop-blur-xl">
          {(
            [
              { id: "graph", label: "Graph", Icon: Network },
              { id: "editor", label: "Editor", Icon: FileText },
              { id: "overview", label: "Overview", Icon: LayoutDashboard },
              { id: "agent", label: "Agent Sim", Icon: Bot },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition-all duration-150",
                activeTab === id
                  ? "bg-white/90 text-slate-800 shadow-sm shadow-black/[0.05] ring-1 ring-slate-200/70"
                  : "text-slate-500 hover:bg-white/60 hover:text-slate-700",
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}

          {activeTab === "editor" && selectedFile && (
            <>
              <div className="mx-2 h-3.5 w-px bg-slate-200" />
              <span className="min-w-0 truncate text-[11px] text-slate-400">
                {selectedFile.path}
              </span>
              <button
                onClick={() => setShowPreview((v) => !v)}
                className={cn(
                  "ml-auto rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-150",
                  showPreview
                    ? "bg-white/90 text-slate-800 shadow-sm ring-1 ring-slate-200/70"
                    : "text-slate-500 hover:bg-white/60 hover:text-slate-700",
                )}
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            </>
          )}
        </div>

        {/* Panels — all mounted, visibility toggled to preserve graph simulation */}
        <div className="relative flex-1 overflow-hidden">
          {/* Graph */}
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-200",
              activeTab !== "graph" && "pointer-events-none opacity-0",
            )}
          >
            <BrainGraph
              graphData={graphData}
              onNodeSelect={handleNodeSelect}
              selectedId={selectedId}
            />
          </div>

          {/* Agent Sim — split: graph on top with highlights, control panel below */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col transition-opacity duration-200",
              activeTab !== "agent" && "pointer-events-none opacity-0",
            )}
          >
            <div className="flex-1 overflow-hidden">
              <BrainGraph
                graphData={graphData}
                onNodeSelect={handleNodeSelect}
                selectedId={selectedId}
                highlightMap={highlightMap}
              />
            </div>
            <div className="h-[52%] min-h-0 flex-shrink-0 overflow-hidden border-t border-slate-200/60 bg-white/60 backdrop-blur-2xl">
              <BrainAgentSim files={files} onHighlightChange={handleHighlightChange} />
            </div>
          </div>

          {/* Editor */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col overflow-hidden transition-opacity duration-200",
              activeTab !== "editor" && "pointer-events-none opacity-0",
            )}
          >
            {selectedFile ? (
              <>
                {/* Meta bar */}
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/50 bg-white/50 px-6 py-2.5 backdrop-blur-sm">
                  <div className={cn("h-2 w-2 rounded-full", typeDot(selectedFile.frontmatter.type))} />
                  <span className="text-xs font-medium text-slate-700">
                    {selectedFile.frontmatter.title ?? selectedFile.path}
                  </span>
                  {selectedFile.frontmatter.importance && (
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[10px] font-medium",
                        importanceBadge(selectedFile.frontmatter.importance),
                      )}
                    >
                      {selectedFile.frontmatter.importance}
                    </span>
                  )}
                  {selectedFile.frontmatter.updated && (
                    <span className="text-[10px] text-slate-400">
                      {selectedFile.frontmatter.updated}
                    </span>
                  )}
                  {selectedFile.frontmatter.links?.length ? (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-400">
                      <GitBranch size={10} />
                      {selectedFile.frontmatter.links.length} links
                    </span>
                  ) : null}
                </div>

                {showPreview ? (
                  <div className="flex-1 overflow-y-auto bg-white/20 px-8 py-7">
                    {/* Frontmatter card */}
                    <FrontmatterCard file={selectedFile} />
                    {/* Markdown body */}
                    <div className="prose prose-slate max-w-3xl leading-7 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-800 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-700 [&_p]:text-slate-600 [&_li]:text-slate-600 [&_code]:bg-slate-100 [&_code]:text-violet-700 [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[12px] [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:rounded-xl [&_pre]:p-4 [&_blockquote]:border-l-violet-400 [&_blockquote]:text-slate-500 [&_a]:text-violet-600 [&_a]:no-underline [&_a:hover]:underline [&_table]:w-full [&_th]:bg-slate-100 [&_th]:text-slate-700 [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-slate-100 [&_input[type=checkbox]]:accent-violet-600">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedFile.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto bg-slate-50/40">
                    <pre className="min-h-full whitespace-pre-wrap px-10 py-8 font-mono text-sm leading-7 text-slate-600">
                      {selectedFile.content}
                    </pre>
                  </div>
                )}

                {/* Linked files */}
                {selectedFile.frontmatter.links?.length ? (
                  <div className="border-t border-slate-200/50 bg-white/50 px-6 py-3 backdrop-blur-sm">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      Linked
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFile.frontmatter.links.map((linkId) => {
                        const linked = files.find((f) => f.frontmatter.id === linkId);
                        return linked ? (
                          <button
                            key={linkId}
                            onClick={() => openFile(linked)}
                            className="rounded-full border border-slate-200/70 bg-white/70 px-2.5 py-0.5 text-[10px] text-slate-500 transition-all hover:border-violet-300/60 hover:bg-violet-50/80 hover:text-violet-600"
                          >
                            {linked.frontmatter.title ?? linked.path}
                          </button>
                        ) : (
                          <span
                            key={linkId}
                            className="rounded-full border border-slate-200/40 px-2.5 py-0.5 text-[10px] text-slate-400"
                          >
                            {linkId}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400 text-sm">
                Select a file from the sidebar
              </div>
            )}
          </div>

          {/* Overview */}
          <div
            className={cn(
              "absolute inset-0 overflow-y-auto transition-opacity duration-200",
              activeTab !== "overview" && "pointer-events-none opacity-0",
            )}
          >
            <Overview files={files} graphData={graphData} onFileClick={openFile} />
          </div>
        </div>
      </div>

      {/* collapse toggle (right closed) */}
      {!rightOpen && (
        <button
          onClick={() => setRightOpen(true)}
          className="flex items-center justify-center border-l border-slate-200/60 bg-white/50 px-1.5 backdrop-blur-xl transition-colors hover:bg-white/70"
        >
          <ChevronLeft size={12} className="text-slate-400" />
        </button>
      )}

      {/* ── Right panel ─────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col border-l border-slate-200/60 transition-all duration-300 ease-out",
          "bg-white/60 backdrop-blur-2xl",
          rightOpen ? "w-80 min-w-80" : "w-0 min-w-0 overflow-hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200/50 px-4 py-3.5">
          <div className="flex items-center gap-2">
            {activeTab === "agent" ? (
              <Bot size={13} className="text-violet-500" />
            ) : (
              <MessageSquare size={13} className="text-violet-500" />
            )}
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {activeTab === "agent" ? "Graph Legend" : "Ask Brian"}
            </span>
          </div>
          <button
            onClick={() => setRightOpen(false)}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100/70 hover:text-slate-600"
          >
            <ChevronRight size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === "agent" ? (
            <AgentLegend hasHighlight={!!highlightMap?.size} />
          ) : (
            <BrainChat />
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function groupByFolder(files: BrianFile[]): Record<string, BrianFile[]> {
  const result: Record<string, BrianFile[]> = {};
  for (const file of files) {
    const folder = file.path.includes("/") ? file.path.split("/")[0] : "_root";
    (result[folder] ??= []).push(file);
  }
  return result;
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function Overview({
  files,
  graphData,
  onFileClick,
}: {
  files: BrianFile[];
  graphData: GraphData;
  onFileClick: (file: BrianFile) => void;
}) {
  // ── analytics ──────────────────────────────────────────────────────────────
  const lc = new Map<string, number>();
  for (const l of graphData.links) {
    lc.set(l.source, (lc.get(l.source) ?? 0) + 1);
    lc.set(l.target, (lc.get(l.target) ?? 0) + 1);
  }

  const typeCounts = files.reduce<Record<string, number>>((acc, f) => {
    const t = f.frontmatter.type ?? "unknown";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  // Keyword frequency
  const kwFreq: Record<string, number> = {};
  for (const f of files) {
    for (const kw of f.frontmatter.keywords ?? []) {
      kwFreq[kw] = (kwFreq[kw] ?? 0) + 1;
    }
  }
  const topKeywords = Object.entries(kwFreq).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const maxKwFreq = topKeywords[0]?.[1] ?? 1;

  // Health checks
  const isolated = files.filter((f) => {
    const id = f.frontmatter.id ?? f.path;
    return !graphData.links.some((l) => l.source === id || l.target === id);
  });
  const STALE_DAYS = 30;
  const stale = files.filter((f) => {
    if (!f.frontmatter.updated) return true;
    const d = new Date(f.frontmatter.updated);
    return (Date.now() - d.getTime()) / 86400000 > STALE_DAYS;
  });
  const noKeywords = files.filter((f) => !f.frontmatter.keywords?.length);
  const healthIssues = [
    ...(isolated.length ? [`${isolated.length} isolated file${isolated.length > 1 ? "s" : ""} (no connections)`] : []),
    ...(stale.length ? [`${stale.length} file${stale.length > 1 ? "s" : ""} not updated in ${STALE_DAYS}+ days`] : []),
    ...(noKeywords.length ? [`${noKeywords.length} file${noKeywords.length > 1 ? "s" : ""} missing keywords`] : []),
  ];

  // Agent reading order: importance + connectivity
  const prioritized = [...files].sort((a, b) => {
    const impOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const ia = impOrder[a.frontmatter.importance ?? "medium"] ?? 2;
    const ib = impOrder[b.frontmatter.importance ?? "medium"] ?? 2;
    if (ia !== ib) return ia - ib;
    const idA = a.frontmatter.id ?? a.path;
    const idB = b.frontmatter.id ?? b.path;
    return (lc.get(idB) ?? 0) - (lc.get(idA) ?? 0);
  }).slice(0, 8);

  // Recently updated
  const recentFiles = [...files]
    .filter((f) => f.frontmatter.updated)
    .sort((a, b) => (b.frontmatter.updated ?? "") > (a.frontmatter.updated ?? "") ? 1 : -1)
    .slice(0, 6);

  const avgConnections = graphData.nodes.length
    ? ((graphData.links.length * 2) / graphData.nodes.length).toFixed(1)
    : "0";
  const totalKeywords = Object.keys(kwFreq).length;

  return (
    <div className="space-y-7 bg-white/20 px-6 py-6">

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Files", value: files.length, Icon: FileText, color: "text-violet-600", bg: "bg-violet-100/80" },
          { label: "Connections", value: graphData.links.length, Icon: GitBranch, color: "text-blue-600", bg: "bg-blue-100/80" },
          { label: "Avg Links", value: avgConnections, Icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-100/80" },
          { label: "Keywords", value: totalKeywords, Icon: Hash, color: "text-amber-600", bg: "bg-amber-100/80" },
        ].map(({ label, value, Icon, color, bg }) => (
          <GlassCard key={label} className="flex items-center gap-3 px-4 py-4">
            <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl", bg)}>
              <Icon size={16} className={color} />
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums text-slate-800">{value}</p>
              <p className="text-[10px] text-slate-400">{label}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* ── Brain Health ───────────────────────────────────────────────── */}
      <section>
        <SectionLabel>Brain health</SectionLabel>
        <div className={cn(
          "rounded-2xl border p-4",
          healthIssues.length === 0
            ? "border-emerald-200/60 bg-emerald-50/80"
            : "border-amber-200/60 bg-amber-50/80",
        )}>
          <div className="flex items-center gap-2 mb-2">
            {healthIssues.length === 0 ? (
              <CheckCircle2 size={14} className="text-emerald-600" />
            ) : (
              <AlertTriangle size={14} className="text-amber-600" />
            )}
            <p className={cn("text-xs font-semibold", healthIssues.length === 0 ? "text-emerald-700" : "text-amber-700")}>
              {healthIssues.length === 0
                ? "All systems healthy — brain is well-connected and current"
                : `${healthIssues.length} issue${healthIssues.length > 1 ? "s" : ""} detected`}
            </p>
          </div>
          {healthIssues.length > 0 && (
            <ul className="space-y-1">
              {healthIssues.map((issue, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className="h-1 w-1 flex-shrink-0 rounded-full bg-amber-400" />
                  {issue}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-amber-200/40 pt-3">
            {[
              { label: "Isolated", value: isolated.length, bad: isolated.length > 0 },
              { label: "Stale", value: stale.length, bad: stale.length > 0 },
              { label: "No keywords", value: noKeywords.length, bad: noKeywords.length > 0 },
            ].map(({ label, value, bad }) => (
              <div key={label} className="text-center">
                <p className={cn("text-lg font-bold tabular-nums", bad ? "text-amber-700" : "text-emerald-600")}>{value}</p>
                <p className="text-[9px] text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Agent Reading Order ────────────────────────────────────────── */}
      <section>
        <div className="mb-3.5 flex items-center gap-2">
          <SectionLabel className="mb-0">Agent reading order</SectionLabel>
          <span className="rounded-full border border-violet-200/60 bg-violet-50/80 px-2 py-0.5 text-[9px] text-violet-600">
            What the AI reads first
          </span>
        </div>
        <div className="space-y-1.5">
          {prioritized.map((f, i) => {
            const id = f.frontmatter.id ?? f.path;
            const connections = lc.get(id) ?? 0;
            return (
              <button
                key={f.path}
                onClick={() => onFileClick(f)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/80 bg-white/60 px-3 py-2.5 text-left shadow-sm transition-all hover:bg-white/90 hover:shadow-md"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 tabular-nums">
                  {i + 1}
                </span>
                <div className={cn("h-2 w-2 flex-shrink-0 rounded-full", typeDot(f.frontmatter.type))} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-700">{f.frontmatter.title ?? f.path}</p>
                  <p className="text-[9px] capitalize text-slate-400">{f.frontmatter.type?.replace(/_/g, " ")}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {f.frontmatter.importance === "critical" && (
                    <span className="rounded-full border border-red-200/60 bg-red-50 px-1.5 py-0.5 text-[8px] font-medium text-red-600">critical</span>
                  )}
                  {connections > 0 && (
                    <span className="text-[9px] text-slate-400">{connections}↔</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Keyword Cloud ─────────────────────────────────────────────── */}
      {topKeywords.length > 0 && (
        <section>
          <div className="mb-3.5 flex items-center gap-2">
            <SectionLabel className="mb-0">Keyword cloud</SectionLabel>
            <span className="text-[9px] text-slate-400">sized by frequency</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topKeywords.map(([kw, count]) => {
              const scale = 0.75 + (count / maxKwFreq) * 0.5; // 0.75 → 1.25
              const opacity = 0.6 + (count / maxKwFreq) * 0.4;
              return (
                <span
                  key={kw}
                  className="rounded-full border border-violet-200/60 bg-violet-50/80 px-2.5 py-1 font-medium text-violet-700 transition-all hover:bg-violet-100/80"
                  style={{ fontSize: `${Math.round(scale * 10)}px`, opacity }}
                  title={`${count} occurrence${count > 1 ? "s" : ""}`}
                >
                  {kw}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recently Updated ──────────────────────────────────────────── */}
      {recentFiles.length > 0 && (
        <section>
          <SectionLabel>Recently updated</SectionLabel>
          <div className="space-y-1.5">
            {recentFiles.map((f) => (
              <button
                key={f.path}
                onClick={() => onFileClick(f)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/80 bg-white/60 px-3 py-2.5 text-left shadow-sm transition-all hover:bg-white/90 hover:shadow-md"
              >
                <Clock size={12} className="flex-shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-700">{f.frontmatter.title ?? f.path}</p>
                </div>
                <span className="flex-shrink-0 text-[10px] text-slate-400">{f.frontmatter.updated}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Type distribution ─────────────────────────────────────────── */}
      <section>
        <SectionLabel>By type</SectionLabel>
        <div className="space-y-2">
          {Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <div className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", typeDot(type))} />
                <span className="w-28 truncate text-[11px] capitalize text-slate-500">
                  {type.replace(/_/g, " ")}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/60">
                  <div
                    className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", typeBar(type))}
                    style={{ width: `${(count / files.length) * 100}%` }}
                  />
                </div>
                <span className="w-4 text-right text-[11px] font-semibold tabular-nums text-slate-600">{count}</span>
              </div>
            ))}
        </div>
      </section>

    </div>
  );
}

// ─── small reusables ─────────────────────────────────────────────────────────

function AgentLegend({ hasHighlight }: { hasHighlight: boolean }) {
  return (
    <div className="space-y-5 px-4 py-5">
      <div>
        <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Highlight key
        </p>
        <div className="space-y-3">
          {[
            {
              dot: "bg-violet-600 shadow-[0_0_8px_rgba(139,92,246,0.5)]",
              ring: "ring-violet-300/50",
              label: "Primary",
              desc: "First read — agent needs this to start",
              labelColor: "text-violet-700",
            },
            {
              dot: "bg-slate-400",
              ring: "ring-slate-300/50",
              label: "Secondary",
              desc: "Supporting context — fills in the picture",
              labelColor: "text-slate-600",
            },
            {
              dot: "bg-slate-300",
              ring: "ring-slate-200/50",
              label: "Referenced",
              desc: "Briefly consulted — cross-check only",
              labelColor: "text-slate-500",
            },
          ].map(({ dot, ring, label, desc, labelColor }) => (
            <div key={label} className="flex items-start gap-3">
              <div className={cn("mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2", dot, ring)} />
              <div>
                <p className={cn("text-xs font-semibold", labelColor)}>{label}</p>
                <p className="text-[11px] text-slate-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white/70 p-3">
        <p className="text-[11px] leading-5 text-slate-500">
          <span className="font-medium text-slate-700">Dimmed nodes</span> are not read by the agent for this task — they&apos;re irrelevant given the current objective.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <div className="relative mt-1 h-3 w-3 flex-shrink-0">
          <div className="absolute inset-0 animate-ping rounded-full bg-violet-400 opacity-50" />
          <div className="absolute inset-0.5 rounded-full bg-violet-600" />
        </div>
        <p className="text-[11px] leading-5 text-slate-500">
          <span className="font-medium text-slate-700">Pulsing nodes</span> are primary reads — the agent spends the most time on these.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200/60 bg-white/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              hasHighlight
                ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                : "bg-slate-300",
            )}
          />
          <p className="text-[10px] text-slate-500">
            {hasHighlight
              ? "Scenario active — graph is filtered"
              : "No scenario selected — showing full graph"}
          </p>
        </div>
      </div>

      <div className="text-[10px] leading-5 text-slate-400">
        Tip: Use auto-play to watch the agent build context step by step.
      </div>
    </div>
  );
}

function GlassCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/80 bg-white/70 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("mb-3.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400", className)}>
      {children}
    </p>
  );
}

// ─── Frontmatter card ─────────────────────────────────────────────────────────

const IMPORTANCE_PILL: Record<string, string> = {
  critical: "border-red-300/60 bg-red-50 text-red-700",
  high: "border-amber-300/60 bg-amber-50 text-amber-700",
  medium: "border-sky-300/60 bg-sky-50 text-sky-700",
  low: "border-slate-200/60 bg-slate-50 text-slate-500",
};

const TYPE_PILL: Record<string, string> = {
  architecture: "border-blue-300/60 bg-blue-50 text-blue-700",
  decision: "border-red-300/60 bg-red-50 text-red-700",
  decision_log: "border-red-300/60 bg-red-50 text-red-700",
  integration: "border-green-300/60 bg-green-50 text-green-700",
  agent_prompt: "border-purple-300/60 bg-purple-50 text-purple-700",
  summary: "border-cyan-300/60 bg-cyan-50 text-cyan-700",
  context: "border-slate-300/60 bg-slate-50 text-slate-600",
  goals: "border-pink-300/60 bg-pink-50 text-pink-700",
  map: "border-orange-300/60 bg-orange-50 text-orange-700",
  index: "border-amber-300/60 bg-amber-50 text-amber-700",
};

function FrontmatterCard({ file }: { file: BrianFile }) {
  const fm = file.frontmatter;
  if (!fm.type && !fm.importance && !fm.keywords?.length && !fm.updated) return null;

  return (
    <div className="mb-6 rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        {fm.type && (
          <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize", TYPE_PILL[fm.type] ?? "border-slate-200/60 bg-slate-50 text-slate-600")}>
            {fm.type.replace(/_/g, " ")}
          </span>
        )}
        {fm.importance && (
          <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize", IMPORTANCE_PILL[fm.importance] ?? "border-slate-200/60 bg-slate-50 text-slate-500")}>
            {fm.importance} importance
          </span>
        )}
        {fm.status && (
          <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2.5 py-0.5 text-[11px] text-slate-500 capitalize">
            {fm.status}
          </span>
        )}
        {fm.updated && (
          <span className="ml-auto text-[11px] text-slate-400">Updated {fm.updated}</span>
        )}
      </div>
      {fm.keywords && fm.keywords.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fm.keywords.map((kw) => (
            <span key={kw} className="rounded-full border border-violet-200/60 bg-violet-50/80 px-2.5 py-0.5 text-[11px] text-violet-600">
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
