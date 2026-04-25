"use client";

import { useCallback, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Folder,
  GitBranch,
  Hash,
  LayoutDashboard,
  Link2,
  Map as MapIcon,
  MessageSquare,
  Network,
  PlugZap,
  Plus,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { BrainAgentSim } from "@/components/brain-agent-sim";
import { BrainChat } from "@/components/brain-chat";
import { BrainGraph } from "@/components/brain-graph";
import type { UpdateVisuState } from "@/components/brain-graph";
import { BrainUpdatePanel } from "@/components/brain-update-panel";
import type { UpdateEvent } from "@/components/brain-update-panel";
import type { BrianFile, GraphData, GraphLink, GraphNode } from "@/lib/brian/reader";
import type { Relevance } from "@/lib/brian/scenarios";
import { cn } from "@/lib/utils";

const MODULE_LOAD_TIME = Date.now();

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
type RightMode = "inspector" | "ai";

interface Props {
  files: BrianFile[];
  graphData: GraphData;
}

export function BrainWorkspaceV2({ files, graphData }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("graph");
  const [selectedFile, setSelectedFile] = useState<BrianFile | null>(
    files.find((f) => f.frontmatter.importance === "critical") ?? files[0] ?? null,
  );
  const [showPreview, setShowPreview] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightMode, setRightMode] = useState<RightMode>("inspector");
  const [selectedEdge, setSelectedEdge] = useState<GraphLink | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [highlightMap, setHighlightMap] = useState<Map<string, Relevance> | undefined>();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateVisu, setUpdateVisu] = useState<UpdateVisuState>({
    active: null, queued: new Set(), done: new Set(), totalOps: 0, appliedOps: 0,
  });
  /** Sidebar folder keys; omitted or true = expanded, false = collapsed */
  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({});

  // Queue-based sequential update visualization
  const opQueueRef = useRef<Array<{ path: string; kind: string; reason: string }>>([]);
  const updateProcessingRef = useRef(false);
  const updateTotalRef = useRef(0);
  const updateAppliedRef = useRef(0);

  const handleHighlightChange = useCallback(
    (map: Map<string, Relevance> | undefined) => setHighlightMap(map),
    [],
  );

  const processNextUpdateOp = useCallback(() => {
    if (!opQueueRef.current.length) {
      updateProcessingRef.current = false;
      return;
    }
    updateProcessingRef.current = true;
    const op = opQueueRef.current.shift()!;
    updateAppliedRef.current++;
    const appliedNow = updateAppliedRef.current;

    // Phase 1: show as "active" — camera will pan to this node
    setUpdateVisu((prev) => ({
      ...prev,
      active: op,
      queued: new Set([...prev.queued].filter((p) => p !== op.path)),
      appliedOps: appliedNow,
    }));

    // Phase 2: after 750ms, mark as done and move to next
    setTimeout(() => {
      setUpdateVisu((prev) => ({
        ...prev,
        active: null,
        done: new Set([...prev.done, op.path]),
      }));
      // Brief pause between ops so each result is visible
      setTimeout(processNextUpdateOp, 280);
    }, 780);
  }, []);

  const handleUpdateEvent = useCallback((event: UpdateEvent) => {
    // Queue planned ops so the graph can show queued (violet dashed) nodes
    if (event.type === "op_planned" && event.op.target_file) {
      updateTotalRef.current++;
      const total = updateTotalRef.current;
      setUpdateVisu((prev) => ({
        ...prev,
        queued: new Set([...prev.queued, event.op.target_file]),
        totalOps: total,
      }));
      return;
    }
    // Drive sequential visualization from op_applied events (actual writes)
    if (event.type === "op_applied" && event.path && event.success && event.change_type !== "ignored") {
      const item = { path: event.path, kind: event.change_type ?? "modified", reason: "" };
      opQueueRef.current.push(item);
      if (!updateProcessingRef.current) processNextUpdateOp();
    }
  }, [processNextUpdateOp]);

  const handleUpdateDone = useCallback(() => {
    // Wait for the visual queue to drain before refreshing
    const waitForDrain = () => {
      if (updateProcessingRef.current || opQueueRef.current.length > 0) {
        setTimeout(waitForDrain, 100);
        return;
      }
      setTimeout(() => {
        setUpdateVisu({ active: null, queued: new Set(), done: new Set(), totalOps: 0, appliedOps: 0 });
        opQueueRef.current = [];
        updateTotalRef.current = 0;
        updateAppliedRef.current = 0;
        router.refresh();
      }, 1400);
    };
    waitForDrain();
  }, [router]);

  function openFile(file: BrianFile, tab?: Tab) {
    setSelectedFile(file);
    setActiveTab(tab ?? "editor");
    setSelectedEdge(null);
    setRightMode("inspector");
    setRightOpen(true);
    setShowPreview(true);
  }

  function handleNodeSelect(node: GraphNode | null, switchToEditor = false) {
    if (!node) return;
    const f = files.find(
      (file) => file.frontmatter.id === node.id || file.path === node.path,
    );
    if (f) {
      setSelectedFile(f);
      setSelectedEdge(null);
      setRightMode("inspector");
      setRightOpen(true);
      setShowPreview(true);
      if (switchToEditor) setActiveTab("editor");
    }
  }

  async function mutateLink(method: "POST" | "DELETE", sourceId: string, targetId: string) {
    setSaveState("saving");
    const res = await fetch("/api/brain/links", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, targetId }),
    });
    if (!res.ok) {
      setSaveState("error");
      return;
    }
    setSaveState("saved");
    setSelectedEdge(null);
    router.refresh();
    setTimeout(() => setSaveState("idle"), 1400);
  }

  const fileTree = buildFileTree(files);
  const selectedId =
    selectedFile?.frontmatter.id ?? selectedFile?.path ?? undefined;

  const toggleNavFolder = useCallback((pathKey: string) => {
    setNavExpanded((prev) => {
      const expanded = prev[pathKey] !== false;
      return { ...prev, [pathKey]: !expanded };
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden">
      {/* ── Left sidebar ────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex flex-col border-r border-slate-200/60 transition-all duration-300 ease-out",
          "bg-gradient-to-b from-slate-50/90 to-violet-50/30 backdrop-blur-2xl",
          leftOpen ? "w-64 min-w-64" : "w-0 min-w-0 overflow-hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200/50 px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200/50">
              <BookOpen size={14} className="text-violet-600" />
            </div>
            <div>
              <span className="block text-[11px] font-semibold text-slate-800">Brain</span>
              <span className="text-[9px] text-slate-400">Notes &amp; context</span>
            </div>
          </div>
          <button
            onClick={() => setLeftOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/80 hover:text-slate-600"
            title="Collapse sidebar"
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-1.5">
          <BrainSidebarTree
            node={fileTree}
            depth={0}
            selectedPath={selectedFile?.path}
            navExpanded={navExpanded}
            onToggleFolder={toggleNavFolder}
            onSelectFile={openFile}
          />
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

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => { setUpdateOpen(true); setRightOpen(true); }}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150",
                updateOpen
                  ? "bg-violet-100 text-violet-700 shadow-sm ring-1 ring-violet-200/70"
                  : "text-slate-500 hover:bg-violet-50 hover:text-violet-600",
              )}
            >
              <Plus size={13} />
              Update Brain
            </button>
          </div>

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
              onNodeSelect={(node) => handleNodeSelect(node, false)}
              onEdgeSelect={(edge) => {
                setSelectedEdge(edge);
                if (edge) {
                  setRightMode("inspector");
                  setRightOpen(true);
                }
              }}
              onLinkCreate={(sourceId, targetId) => mutateLink("POST", sourceId, targetId)}
              selectedId={selectedId}
              selectedEdge={selectedEdge}
              updateVisu={updateOpen ? updateVisu : undefined}
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
                onNodeSelect={(node) => handleNodeSelect(node, false)}
                onEdgeSelect={setSelectedEdge}
                onLinkCreate={(sourceId, targetId) => mutateLink("POST", sourceId, targetId)}
                selectedId={selectedId}
                selectedEdge={selectedEdge}
                highlightMap={highlightMap}
              />
            </div>
            <div className="h-[58%] min-h-0 flex-shrink-0 overflow-hidden border-t border-slate-200/60">
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
                  <DocumentPreview file={selectedFile} files={files} onFileClick={openFile} />
                ) : (
                  <div className="flex-1 overflow-y-auto bg-slate-50/40">
                    <pre className="min-h-full whitespace-pre-wrap px-10 py-8 font-mono text-sm leading-7 text-slate-600">
                      {selectedFile.content}
                    </pre>
                  </div>
                )}
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
            {updateOpen ? <Plus size={13} className="text-violet-500" /> : rightMode === "ai" ? <Bot size={13} className="text-violet-500" /> : <MessageSquare size={13} className="text-violet-500" />}
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {updateOpen ? "Update Brain" : rightMode === "ai" ? "Ask Brian" : selectedEdge ? "Connection" : "Context Inspector"}
            </span>
          </div>
          {!updateOpen && (
            <div className="ml-auto mr-2 flex rounded-xl border border-slate-200/60 bg-white/70 p-0.5">
              <button
                onClick={() => setRightMode("inspector")}
                className={cn("rounded-lg px-2 py-1 text-[10px] font-medium transition", rightMode === "inspector" ? "bg-violet-100 text-violet-700" : "text-slate-400 hover:text-slate-600")}
              >
                Inspect
              </button>
              <button
                onClick={() => setRightMode("ai")}
                className={cn("rounded-lg px-2 py-1 text-[10px] font-medium transition", rightMode === "ai" ? "bg-violet-100 text-violet-700" : "text-slate-400 hover:text-slate-600")}
              >
                AI
              </button>
            </div>
          )}
          <button
            onClick={() => { setRightOpen(false); if (updateOpen) setUpdateOpen(false); }}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100/70 hover:text-slate-600"
          >
            <ChevronRight size={12} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {updateOpen ? (
            <BrainUpdatePanel
              onClose={() => setUpdateOpen(false)}
              onEvent={handleUpdateEvent}
              onDone={handleUpdateDone}
            />
          ) : rightMode === "ai" ? (
            <BrainChat contextHint={selectedFile ? `Selected brain file: ${selectedFile.path}\nTitle: ${selectedFile.frontmatter.title ?? selectedFile.path}\nContent:\n${selectedFile.content}` : undefined} />
          ) : activeTab === "agent" ? (
            <AgentLegend hasHighlight={!!highlightMap?.size} />
          ) : selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              files={files}
              saveState={saveState}
              onOpenNode={(id) => {
                const node = graphData.nodes.find((n) => n.id === id);
                if (node) handleNodeSelect(node, false);
              }}
              onDelete={() => mutateLink("DELETE", selectedEdge.source, selectedEdge.target)}
            />
          ) : selectedFile ? (
            <GraphNodeInspector
              file={selectedFile}
              files={files}
              graphData={graphData}
              onOpenFile={(file) => {
                setSelectedFile(file);
                setSelectedEdge(null);
              }}
              onOpenEditor={() => setActiveTab("editor")}
              onAskAI={() => setRightMode("ai")}
            />
          ) : (
            <EmptyInspector />
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── sidebar file tree ───────────────────────────────────────────────────────

const importanceRank: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function compareFilesForNav(a: BrianFile, b: BrianFile) {
  const ao = importanceRank[a.frontmatter.importance ?? "medium"] ?? 2;
  const bo = importanceRank[b.frontmatter.importance ?? "medium"] ?? 2;
  if (ao !== bo) return ao - bo;
  return a.path.localeCompare(b.path);
}

type FileTreeNode = {
  pathKey: string;
  segment: string;
  children: FileTreeNode[];
  files: BrianFile[];
};

function humanizePathSegment(segment: string): string {
  const spaced = segment.replace(/_/g, " ").replace(/-/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildFileTree(files: BrianFile[]): FileTreeNode {
  const root: FileTreeNode = { pathKey: "", segment: "", children: [], files: [] };

  function ensureChild(parent: FileTreeNode, segment: string): FileTreeNode {
    const pathKey = parent.pathKey ? `${parent.pathKey}/${segment}` : segment;
    let child = parent.children.find((c) => c.pathKey === pathKey);
    if (!child) {
      child = { pathKey, segment, children: [], files: [] };
      parent.children.push(child);
    }
    return child;
  }

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (!segments.length) continue;
    const dirParts = segments.slice(0, -1);
    let node = root;
    for (const seg of dirParts) {
      node = ensureChild(node, seg);
    }
    node.files.push(file);
  }

  function sortTree(node: FileTreeNode) {
    node.children.sort((a, b) =>
      a.segment.localeCompare(b.segment, undefined, { sensitivity: "base" }),
    );
    node.files.sort(compareFilesForNav);
    node.children.forEach(sortTree);
  }
  sortTree(root);
  return root;
}

function filePrimaryLabel(file: BrianFile): string {
  const t = file.frontmatter.title?.trim();
  if (t) return t;
  const base = file.path.split("/").pop()?.replace(/\.md$/i, "") ?? file.path;
  return humanizePathSegment(base);
}

function fileContextPath(file: BrianFile): string {
  const i = file.path.lastIndexOf("/");
  if (i <= 0) return "";
  return file.path.slice(0, i).replace(/\//g, " · ");
}

type IconProps = { size?: number; className?: string };
const FILE_TYPE_ICON: Record<string, ComponentType<IconProps>> = {
  index: Hash,
  architecture: LayoutDashboard,
  decision: AlertTriangle,
  decision_log: AlertTriangle,
  integration: PlugZap,
  agent_prompt: Bot,
  summary: BookOpen,
  context: FileText,
  goals: TrendingUp,
  map: MapIcon,
  timeline: Clock,
  overview: LayoutDashboard,
};

const FILE_TYPE_ICON_CLASS: Record<string, string> = {
  index: "text-amber-500",
  architecture: "text-blue-500",
  decision: "text-red-500",
  decision_log: "text-red-500",
  integration: "text-emerald-500",
  agent_prompt: "text-violet-500",
  summary: "text-cyan-500",
  context: "text-slate-500",
  goals: "text-pink-500",
  map: "text-orange-500",
  timeline: "text-sky-500",
  overview: "text-indigo-500",
};

function FileRowIcon({ type }: { type?: string }) {
  const Icon = FILE_TYPE_ICON[type ?? ""] ?? FileText;
  const cls = FILE_TYPE_ICON_CLASS[type ?? ""] ?? "text-slate-400";
  return <Icon size={14} className={cn("flex-shrink-0", cls)} />;
}

function BrainSidebarTree({
  node,
  depth,
  selectedPath,
  navExpanded,
  onToggleFolder,
  onSelectFile,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath?: string;
  navExpanded: Record<string, boolean>;
  onToggleFolder: (pathKey: string) => void;
  onSelectFile: (file: BrianFile, tab?: Tab) => void;
}) {
  const pad = depth === 0 ? "pl-1" : depth === 1 ? "pl-2" : "pl-3";

  return (
    <div className={cn(pad, depth > 0 && "border-l border-slate-200/70 ml-2.5")}>
      {depth === 0 && node.files.length > 0 && (
        <div className="mb-2">
          <p className="px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Top level
          </p>
          {node.files.map((file) => (
            <SidebarFileButton
              key={file.path}
              file={file}
              active={selectedPath === file.path}
              onSelect={() => onSelectFile(file)}
            />
          ))}
        </div>
      )}

      {node.children.map((child) => {
        const expanded = navExpanded[child.pathKey] !== false;
        const totalInTree = countFilesInSubtree(child);
        return (
          <div key={child.pathKey} className="mb-0.5">
            <button
              type="button"
              onClick={() => onToggleFolder(child.pathKey)}
              className={cn(
                "flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left transition-colors",
                "hover:bg-white/70 text-slate-700",
              )}
              style={{ paddingLeft: depth === 0 ? 6 : 4 }}
            >
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-400">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <Folder size={13} className="flex-shrink-0 text-violet-400" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-800">
                {humanizePathSegment(child.segment)}
              </span>
              <span className="flex-shrink-0 rounded-md bg-slate-100/90 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-slate-500">
                {totalInTree}
              </span>
            </button>

            {expanded && (
              <div className="mt-0.5 space-y-0.5">
                {child.files.map((file) => (
                  <SidebarFileButton
                    key={file.path}
                    file={file}
                    active={selectedPath === file.path}
                    onSelect={() => onSelectFile(file)}
                  />
                ))}
                <BrainSidebarTree
                  node={child}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  navExpanded={navExpanded}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function countFilesInSubtree(node: FileTreeNode): number {
  let n = node.files.length;
  for (const c of node.children) n += countFilesInSubtree(c);
  return n;
}

function SidebarFileButton({
  file,
  active,
  onSelect,
}: {
  file: BrianFile;
  active: boolean;
  onSelect: () => void;
}) {
  const primary = filePrimaryLabel(file);
  const ctx = fileContextPath(file);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-all duration-150",
        active
          ? "bg-violet-100/90 text-violet-900 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.25)]"
          : "text-slate-700 hover:bg-white/80 hover:shadow-sm",
      )}
    >
      <FileRowIcon type={file.frontmatter.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium leading-tight">{primary}</span>
        {ctx ? (
          <span className="mt-0.5 block truncate font-mono text-[9px] leading-tight text-slate-400" title={file.path}>
            {ctx}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fileId(file: BrianFile) {
  return file.frontmatter.id ?? file.path;
}

function summarizeFile(file: BrianFile) {
  const firstParagraph = file.content
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#+\s+/gm, "").trim())
    .find((block) => block.length > 60);
  return (firstParagraph ?? file.content.replace(/^#+\s+/gm, "").trim()).slice(0, 360);
}

function aiOverview(file: BrianFile) {
  const content = file.content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*/g, "")
    .trim();
  const sourceEvidence = content.match(/## Source Evidence\s+([\s\S]*?)(?:\n## |\n# |$)/i)?.[1]
    ?.split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 2);
  const summary = summarizeFile(file).replace(/\s+/g, " ").trim();
  const relationHint = file.frontmatter.links?.length
    ? ` It connects to ${file.frontmatter.links.length} nearby context node${file.frontmatter.links.length === 1 ? "" : "s"} for retrieval.`
    : " It is currently light on explicit links, so it may be a good candidate for more context connections.";
  const evidenceHint = sourceEvidence?.length ? ` Key evidence: ${sourceEvidence.join(" ")}` : "";
  return `${summary}${relationHint}${evidenceHint}`.slice(0, 520);
}

function findById(files: BrianFile[], id: string) {
  return files.find((file) => fileId(file) === id || file.path === id);
}

function GraphNodeInspector({
  file,
  files,
  graphData,
  onOpenFile,
  onOpenEditor,
  onAskAI,
}: {
  file: BrianFile;
  files: BrianFile[];
  graphData: GraphData;
  onOpenFile: (file: BrianFile) => void;
  onOpenEditor: () => void;
  onAskAI: () => void;
}) {
  const id = fileId(file);
  const outbound = (file.frontmatter.links ?? [])
    .map((link) => findById(files, link))
    .filter((item): item is BrianFile => Boolean(item));
  const inbound = files
    .filter((candidate) =>
      (candidate.frontmatter.links ?? []).some((link) => link === id || link === file.path),
    )
    // Deduplicate inbound results to prevent React key errors
    .filter((file, index, self) => self.findIndex((f) => f.path === file.path) === index);

  // Also deduplicate outbound to prevent duplicate keys
  const uniqueOutbound = Array.from(new Map(outbound.map((item) => [item.path, item])).values());
  const connectionCount = graphData.links.filter((link) => link.source === id || link.target === id).length;

  return (
    <div key={file.path} className="flex h-full flex-col overflow-hidden [animation:inspector-in_420ms_cubic-bezier(.2,.9,.2,1)_both]">
      <style>{`
        @keyframes inspector-in {
          from { opacity: 0; transform: translateX(18px) scale(.985); filter: blur(6px); }
          to { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); }
        }
        @keyframes overview-glow {
          0%, 100% { box-shadow: 0 0 0 rgba(139,92,246,0); }
          50% { box-shadow: 0 18px 60px rgba(139,92,246,.16); }
        }
      `}</style>
      <div className="border-b border-slate-200/60 px-4 py-4">
        <div className="mb-3 flex items-start gap-3">
          <div className={cn("mt-1 h-3 w-3 flex-shrink-0 rounded-full", typeDot(file.frontmatter.type))} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold leading-5 text-slate-800">{file.frontmatter.title ?? file.path}</h3>
            <p className="mt-1 truncate font-mono text-[10px] text-violet-500">{file.path}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", importanceBadge(file.frontmatter.importance))}>
            {file.frontmatter.importance ?? "medium"}
          </span>
          <span className="rounded-full border border-slate-200/60 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 capitalize">
            {(file.frontmatter.type ?? "unknown").replace(/_/g, " ")}
          </span>
          <span className="rounded-full border border-blue-200/60 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
            {connectionCount} connections
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="rounded-[1.5rem] border border-violet-100/80 bg-gradient-to-br from-white via-violet-50/70 to-sky-50/80 p-4 shadow-sm [animation:overview-glow_1.2s_ease-out_1]">
          <div className="mb-2 flex items-center gap-2">
            <Bot size={14} className="text-violet-500" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500">AI overview</p>
          </div>
          <p className="text-xs leading-5 text-slate-600">{aiOverview(file)}</p>
        </section>

        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Summary</p>
          <p className="rounded-2xl border border-white/80 bg-white/70 p-3 text-xs leading-5 text-slate-600 shadow-sm">
            {summarizeFile(file)}
          </p>
        </section>

        <ConnectionList title="Outgoing context" files={uniqueOutbound} empty="No outgoing links yet" onOpenFile={onOpenFile} />
        <ConnectionList title="Referenced by" files={inbound} empty="No inbound links yet" onOpenFile={onOpenFile} />

        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Full Markdown</p>
          <div className="max-h-80 overflow-y-auto rounded-2xl border border-slate-200/60 bg-white/80 p-3">
            <div className="prose prose-sm prose-slate max-w-none text-xs leading-5 [&>h1]:text-base [&>h2]:text-sm [&>p]:my-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-200/60 p-3">
        <button onClick={onAskAI} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700">
          Ask AI
        </button>
        <button onClick={onOpenEditor} className="rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
          Open Editor
        </button>
      </div>
    </div>
  );
}

function ConnectionList({
  title,
  files,
  empty,
  onOpenFile,
}: {
  title: string;
  files: BrianFile[];
  empty: string;
  onOpenFile: (file: BrianFile) => void;
}) {
  return (
    <section>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      <div className="space-y-1.5">
        {files.length ? files.map((file) => (
          <button
            key={`${file.path}-${file.frontmatter.id || ""}`}
            onClick={() => onOpenFile(file)}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-200/60 bg-white/75 px-3 py-2 text-left transition hover:bg-white"
          >
            <Link2 size={11} className="flex-shrink-0 text-violet-400" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-600">
              {file.frontmatter.title ?? file.path}
            </span>
          </button>
        )) : (
          <p className="rounded-xl border border-dashed border-slate-200/70 bg-slate-50/70 px-3 py-3 text-center text-[11px] text-slate-400">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}

function EdgeInspector({
  edge,
  files,
  saveState,
  onOpenNode,
  onDelete,
}: {
  edge: GraphLink;
  files: BrianFile[];
  saveState: "idle" | "saving" | "saved" | "error";
  onOpenNode: (id: string) => void;
  onDelete: () => void;
}) {
  const source = findById(files, edge.source);
  const target = findById(files, edge.target);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <PlugZap size={15} className="text-violet-500" />
          <h3 className="text-sm font-semibold text-slate-800">Context connection</h3>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-400">This edge is stored as a Markdown frontmatter link.</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {[
          ["Source", source, edge.source],
          ["Target", target, edge.target],
        ].map(([label, file, fallback]) => (
          <button
            key={String(label)}
            onClick={() => onOpenNode(String(fallback))}
            className="w-full rounded-2xl border border-slate-200/60 bg-white/75 p-3 text-left transition hover:bg-white"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{String(label)}</p>
            <p className="mt-1 text-sm font-semibold text-slate-700">{(file as BrianFile | undefined)?.frontmatter.title ?? String(fallback)}</p>
            <p className="mt-1 truncate font-mono text-[10px] text-violet-500">{(file as BrianFile | undefined)?.path ?? String(fallback)}</p>
          </button>
        ))}
      </div>
      <div className="border-t border-slate-200/60 p-3">
        <button
          onClick={onDelete}
          disabled={saveState === "saving"}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200/70 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
        >
          <Trash2 size={12} />
          {saveState === "saving" ? "Disconnecting..." : "Disconnect context"}
        </button>
        {saveState === "saved" && <p className="mt-2 text-center text-[10px] text-emerald-600">Saved to Markdown frontmatter</p>}
        {saveState === "error" && <p className="mt-2 text-center text-[10px] text-red-500">Could not save this connection</p>}
      </div>
    </div>
  );
}

function EmptyInspector() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Network size={32} className="mb-3 text-slate-300" />
      <p className="text-sm font-semibold text-slate-700">Select a graph element</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        Click a node to inspect its Markdown or click a connection to edit the relationship.
      </p>
    </div>
  );
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
    return (MODULE_LOAD_TIME - d.getTime()) / 86400000 > STALE_DAYS;
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

// ─── Document preview ─────────────────────────────────────────────────────────

function DocumentPreview({
  file,
  files,
  onFileClick,
}: {
  file: import("@/lib/brian/reader").BrianFile;
  files: import("@/lib/brian/reader").BrianFile[];
  onFileClick: (f: import("@/lib/brian/reader").BrianFile) => void;
}) {
  const fm = file.frontmatter;

  // Strip leading H1 if it duplicates the frontmatter title
  const bodyContent = file.content
    .replace(/^---[\s\S]*?---\s*/m, "") // strip frontmatter block
    .replace(/^#\s+.+\n?/, "")          // strip first H1
    .trimStart();

  // Rough reading time: ~200 words per minute
  const wordCount = bodyContent.split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.round(wordCount / 200));

  const displayTitle =
    fm.title ??
    file.path.split("/").pop()?.replace(".md", "").replace(/_/g, " ") ??
    file.path;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">

        {/* ── Document header ─────────────────────────────────────────── */}
        <div className="border-b border-slate-200/50 bg-gradient-to-b from-white/90 via-white/70 to-white/30 px-10 py-10">
          {/* Type + importance pills */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {fm.type && (
              <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold capitalize", TYPE_PILL[fm.type] ?? "border-slate-200/60 bg-slate-50 text-slate-600")}>
                {fm.type.replace(/_/g, " ")}
              </span>
            )}
            {fm.importance && (
              <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold capitalize", IMPORTANCE_PILL[fm.importance] ?? "border-slate-200/60 bg-slate-50 text-slate-500")}>
                {fm.importance} importance
              </span>
            )}
            {fm.status && (
              <span className="rounded-full border border-slate-200/60 bg-white/80 px-3 py-1 text-xs text-slate-500 capitalize">
                {fm.status}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900">
            {displayTitle}
          </h1>

          {/* Meta row */}
          <div className="mt-4 flex flex-wrap items-center gap-5 text-sm text-slate-400">
            {fm.updated && (
              <span className="flex items-center gap-1.5">
                <Calendar size={13} />
                Updated {fm.updated}
              </span>
            )}
            {fm.links && fm.links.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Link2 size={13} />
                {fm.links.length} connection{fm.links.length !== 1 ? "s" : ""}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <BookOpen size={13} />
              {readMins} min read · {wordCount} words
            </span>
          </div>

          {/* Keywords */}
          {fm.keywords && fm.keywords.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {fm.keywords.map((kw) => (
                <span key={kw} className="rounded-full border border-violet-200/60 bg-violet-50/80 px-3 py-1 text-xs font-medium text-violet-600">
                  #{kw}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Markdown body ──────────────────────────────────────────── */}
        <div className="px-10 py-10">
          <div className="max-w-3xl">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="mb-4 mt-8 text-2xl font-bold text-slate-900 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-3 mt-7 text-xl font-semibold text-slate-800">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-2 mt-5 text-base font-semibold text-slate-700">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="mb-4 text-[15px] leading-7 text-slate-600">{children}</p>
                ),
                li: ({ children }) => (
                  <li className="mb-1.5 text-[15px] leading-7 text-slate-600">{children}</li>
                ),
                ul: ({ children }) => (
                  <ul className="mb-4 list-disc pl-6">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-4 list-decimal pl-6">{children}</ol>
                ),
                code: ({ inline, children, ...props }: { inline?: boolean; children?: React.ReactNode }) =>
                  inline ? (
                    <code className="rounded-md border border-violet-200/50 bg-violet-50/80 px-1.5 py-0.5 font-mono text-[13px] text-violet-700" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className="block" {...props}>{children}</code>
                  ),
                pre: ({ children }) => (
                  <pre className="mb-4 overflow-x-auto rounded-2xl border border-slate-800/20 bg-slate-900 p-5 text-sm leading-6 text-slate-100">
                    {children}
                  </pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="mb-4 border-l-4 border-violet-400/60 bg-violet-50/40 pl-5 pr-4 py-3 rounded-r-xl italic text-slate-500">
                    {children}
                  </blockquote>
                ),
                a: ({ href, children }) => (
                  <a href={href} className="text-violet-600 no-underline hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200/60">
                    <table className="w-full text-sm">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="bg-slate-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border-t border-slate-100 px-4 py-2.5 text-slate-600">{children}</td>
                ),
                hr: () => <hr className="my-8 border-slate-200/60" />,
                strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
              }}
            >
              {bodyContent}
            </ReactMarkdown>
          </div>
        </div>

        {/* ── Related documents ──────────────────────────────────────── */}
        {fm.links && fm.links.length > 0 && (
          <div className="border-t border-slate-200/50 bg-white/40 px-10 py-8">
            <div className="flex items-center gap-2 mb-5">
              <Link2 size={14} className="text-slate-400" />
              <p className="text-sm font-semibold text-slate-700">Related documents</p>
              <span className="text-xs text-slate-400">· linked from frontmatter</span>
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-3xl">
              {[...new Set(fm.links)].map((linkId) => {
                const linked = files.find((f) => f.frontmatter.id === linkId);
                return linked ? (
                  <button
                    key={linkId}
                    onClick={() => onFileClick(linked)}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200/60 bg-white/70 p-4 text-left shadow-sm transition-all hover:bg-white/90 hover:shadow-md group"
                  >
                    <div className={cn("mt-0.5 h-2 w-2 flex-shrink-0 rounded-full", typeDot(linked.frontmatter.type))} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 group-hover:text-violet-700 transition-colors truncate">
                        {linked.frontmatter.title ?? linked.path}
                      </p>
                      {linked.frontmatter.type && (
                        <p className="mt-0.5 text-xs text-slate-400 capitalize">
                          {linked.frontmatter.type.replace(/_/g, " ")}
                        </p>
                      )}
                    </div>
                  </button>
                ) : (
                  <div
                    key={linkId}
                    className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200/60 p-4 text-xs text-slate-400"
                  >
                    <Hash size={12} />
                    {linkId}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
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

