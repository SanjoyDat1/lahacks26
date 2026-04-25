"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  Network,
  Send,
  Sparkles,
  Upload,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { githubReposForApi, type GithubRepoFormRow } from "@/lib/brain/github-ingest";
import { cn } from "@/lib/utils";

function newGithubRepoRow(): GithubRepoFormRow {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `gh-${Date.now()}`,
    url: "",
    ref: "",
  };
}

type UploadDoc = {
  id: string;
  name: string;
  text?: string;
  content_base64?: string;
  mime_type?: string;
  size: number;
  chars: number;
  status: "ready" | "scanned" | "distilled";
};

type GraphStatus = "idle" | "active" | "done";

type GraphNode = {
  id: string;
  label: string;
  status: GraphStatus;
};

type GraphEdge = {
  from: string;
  to: string;
  status: GraphStatus;
};

type BrainTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children?: BrainTreeNode[];
};

type CreatedFile = {
  path: string;
  title?: string;
  preview?: string;
  status: "planned" | "writing" | "done";
  links?: string[];
};

type BootstrapEvent =
  | { type: "connected"; message: string }
  | { type: "stage_start"; stage: StageId; label?: string }
  | { type: "thinking"; content: string }
  | { type: "document"; name: string; chars: number; status: "scanned" | "distilled" }
  | { type: "graph_node"; id: string; label: string; status: GraphStatus }
  | { type: "graph_edge"; from: string; to: string; status: GraphStatus }
  | { type: "file_planned"; path: string; title?: string; preview?: string; links?: string[] }
  | { type: "file_writing"; path: string; title?: string }
  | { type: "file_created"; path: string; title?: string; preview?: string }
  | { type: "directory_snapshot"; tree: BrainTreeNode[] }
  | { type: "done"; written_files: string[]; result_text: string }
  | { type: "error"; message: string };

type StageId = "upload" | "normalize" | "distill" | "write" | "index" | "verify" | "done";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".xml",
  ".log",
  ".eml",
]);

const TEXT_UPLOAD_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".xml",
  ".log",
  ".eml",
]);

const STAGES: { id: StageId; label: string; desc: string }[] = [
  { id: "upload", label: "Upload", desc: "Collect source context" },
  { id: "normalize", label: "Scan", desc: "Normalize documents" },
  { id: "distill", label: "Distill", desc: "Extract durable facts" },
  { id: "write", label: "Write", desc: "Create brain files" },
  { id: "index", label: "Index", desc: "Warm retrieval" },
  { id: "verify", label: "Verify", desc: "Confirm readiness" },
];

const INITIAL_NODES: GraphNode[] = [
  { id: "documents", label: "Documents", status: "idle" },
  { id: "normalize", label: "Normalize", status: "idle" },
  { id: "distill", label: "Distill", status: "idle" },
  { id: "brain_files", label: "Brain Files", status: "idle" },
  { id: "index", label: "Index", status: "idle" },
  { id: "ready", label: "Ready", status: "idle" },
];

const INITIAL_EDGES: GraphEdge[] = [
  { from: "documents", to: "normalize", status: "idle" },
  { from: "normalize", to: "distill", status: "idle" },
  { from: "distill", to: "brain_files", status: "idle" },
  { from: "brain_files", to: "index", status: "idle" },
  { from: "index", to: "ready", status: "idle" },
];

export function SessionStartPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<UploadDoc[]>([]);
  const [githubRepos, setGithubRepos] = useState<GithubRepoFormRow[]>(() => [newGithubRepoRow()]);
  const prompt =
    "Build a transparent AI brain for this project from the uploaded documents and any linked GitHub repository context.";
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [stage, setStage] = useState<StageId>("upload");
  const [stageLabel, setStageLabel] = useState("Waiting for documents");
  const [, setNodes] = useState<GraphNode[]>(INITIAL_NODES);
  const [, setEdges] = useState<GraphEdge[]>(INITIAL_EDGES);
  const [tree, setTree] = useState<BrainTreeNode[]>([]);
  const [createdFiles, setCreatedFiles] = useState<CreatedFile[]>([]);
  const [thinking, setThinking] = useState<string[]>([
    "Drop project docs here and I will turn them into a structured brain that agents can inspect.",
  ]);
  const [resultText, setResultText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const thinkingEndRef = useRef<HTMLDivElement>(null);

  const totalChars = useMemo(() => docs.reduce((sum, doc) => sum + doc.chars, 0), [docs]);
  const githubApiList = useMemo(() => githubReposForApi(githubRepos), [githubRepos]);
  const hasBootstrapSource = docs.length > 0 || githubApiList.length > 0;
  const sourceCount = docs.length + githubApiList.length;
  const buildMode = isRunning || isDone || createdFiles.length > 0;
  const completedStages = useMemo(() => {
    if (isDone) return STAGES.length;
    const idx = STAGES.findIndex((item) => item.id === stage);
    return Math.max(0, idx);
  }, [isDone, stage]);

  useEffect(() => {
    let cancelled = false;
    async function checkAgent() {
      try {
        const res = await fetch("/api/agent/stream");
        const data = await res.json();
        if (!cancelled) setAgentOnline(!data.offline);
      } catch {
        if (!cancelled) setAgentOnline(false);
      }
    }
    checkAgent();
    const timer = setInterval(checkAgent, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    thinkingEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thinking]);

  useEffect(() => {
    if (!isDone) return;
    const timer = setTimeout(() => router.push("/brain"), 1600);
    return () => clearTimeout(timer);
  }, [isDone, router]);

  const resetRun = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setIsRunning(false);
    setIsDone(false);
    setError(null);
    setStage("upload");
    setStageLabel("Waiting for documents");
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setTree([]);
    setCreatedFiles([]);
    setResultText("");
    setThinking([
      "Drop project docs here and I will turn them into a structured brain that agents can inspect.",
    ]);
    setDocs((prev) => prev.map((doc) => ({ ...doc, status: "ready" })));
    setGithubRepos([newGithubRepoRow()]);
  }, []);

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    setError(null);
    const files = Array.from(fileList);
    const nextDocs: UploadDoc[] = [];
    const unsupported: string[] = [];

    for (const file of files) {
      const ext = extensionOf(file.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        unsupported.push(file.name);
        continue;
      }
      const isText = TEXT_UPLOAD_EXTENSIONS.has(ext) || file.type.startsWith("text/");
      const text = isText ? await file.text() : undefined;
      const contentBase64 = isText ? undefined : await readFileAsDataUrl(file);
      if (isText && !text?.trim()) continue;
      nextDocs.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        text,
        content_base64: contentBase64,
        mime_type: file.type,
        size: file.size,
        chars: text?.length ?? file.size,
        status: "ready",
      });
    }

    if (unsupported.length) {
      setError(`Unsupported files skipped: ${unsupported.slice(0, 4).join(", ")}${unsupported.length > 4 ? "..." : ""}`);
    }
    if (nextDocs.length) {
      setDocs((prev) => [...prev, ...nextDocs]);
      setThinking((prev) => [
        ...prev,
        `Loaded ${nextDocs.length} document${nextDocs.length === 1 ? "" : "s"} with ${formatNumber(nextDocs.reduce((sum, doc) => sum + doc.chars, 0))} characters.`,
      ]);
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
  }, [addFiles]);

  const handleBootstrapEvent = useCallback((event: BootstrapEvent) => {
    if (event.type === "connected") {
      setStageLabel("Connected to live bootstrap stream");
      return;
    }
    if (event.type === "stage_start") {
      setStage(event.stage);
      setStageLabel(event.label ?? stageTitle(event.stage));
      return;
    }
    if (event.type === "thinking") {
      setThinking((prev) => [...prev, event.content.trim()]);
      return;
    }
    if (event.type === "document") {
      setDocs((prev) =>
        prev.map((doc) =>
          doc.name === event.name
            ? { ...doc, chars: event.chars, status: event.status }
            : doc,
        ),
      );
      return;
    }
    if (event.type === "graph_node") {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === event.id ? { ...node, label: event.label, status: event.status } : node,
        ),
      );
      return;
    }
    if (event.type === "graph_edge") {
      setEdges((prev) =>
        prev.map((edge) =>
          edge.from === event.from && edge.to === event.to ? { ...edge, status: event.status } : edge,
        ),
      );
      return;
    }
    if (event.type === "file_planned") {
      setCreatedFiles((prev) =>
        upsertFile(prev, {
          path: event.path,
          title: event.title,
          preview: event.preview,
          status: "planned",
          links: event.links,
        }),
      );
      return;
    }
    if (event.type === "file_writing") {
      setCreatedFiles((prev) =>
        upsertFile(prev, {
          path: event.path,
          title: event.title,
          status: "writing",
        }),
      );
      return;
    }
    if (event.type === "file_created") {
      setCreatedFiles((prev) =>
        upsertFile(prev, {
          path: event.path,
          title: event.title,
          preview: event.preview,
          status: "done",
        }),
      );
      return;
    }
    if (event.type === "directory_snapshot") {
      setTree(event.tree);
      return;
    }
    if (event.type === "done") {
      setStage("done");
      setStageLabel("Brain ready");
      setIsDone(true);
      setIsRunning(false);
      setResultText(event.result_text);
      setThinking((prev) => [
        ...prev,
        `Done. I wrote ${event.written_files.length} brain file${event.written_files.length === 1 ? "" : "s"} and warmed retrieval for the demo.`,
      ]);
      return;
    }
    if (event.type === "error") {
      setError(event.message);
      setIsRunning(false);
    }
  }, []);

  const runBootstrap = useCallback(() => {
    if (!hasBootstrapSource || isRunning || agentOnline === false) return;

    setIsRunning(true);
    setIsDone(false);
    setError(null);
    setStage("normalize");
    setStageLabel("Connecting to the brain agent");
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setTree([]);
    setCreatedFiles([]);
    setResultText("");
    setThinking([
      "Creating a new session. I will stream every important step instead of hiding the setup behind a spinner.",
      ...(githubApiList.length
        ? [
            `Including ${githubApiList.length} public GitHub repo${githubApiList.length === 1 ? "" : "s"} (clone + scan may take a bit).`,
          ]
        : []),
    ]);

    const ws = new WebSocket(resolveBootstrapWsUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        prompt,
        documents: docs.map(({ name, text, content_base64, mime_type, size }) => ({
          name,
          text,
          content_base64,
          mime_type,
          size,
        })),
        github_repos: githubApiList,
        clone_timeout_s: 300,
        overwrite: true,
        max_files: 24,
      }));
    };

    ws.onmessage = (message) => {
      let event: BootstrapEvent;
      try {
        event = JSON.parse(message.data) as BootstrapEvent;
      } catch {
        return;
      }
      handleBootstrapEvent(event);
    };

    ws.onerror = () => {
      setError("Could not connect to the bootstrap WebSocket. Make sure the agent API is running.");
      setIsRunning(false);
    };

    ws.onclose = () => {
      setIsRunning(false);
    };
  }, [agentOnline, docs, githubApiList, handleBootstrapEvent, hasBootstrapSource, isRunning, prompt]);

  return (
    <main className="relative min-h-[calc(100vh-57px)] overflow-hidden px-6 py-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-12 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="absolute bottom-8 right-10 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl" />
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={Array.from(SUPPORTED_EXTENSIONS).join(",")}
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />

      {!buildMode ? (
        <section className="mx-auto flex min-h-[calc(100vh-120px)] max-w-4xl flex-col items-center justify-center">
          <div className="mb-8 text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-violet-200/60 bg-white/75 px-4 py-2 text-xs font-semibold text-violet-700 shadow-sm backdrop-blur-2xl">
              <Sparkles size={13} className="text-violet-500" />
              AI Brain Session Builder
            </div>
            <h1 className="mt-6 text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
              Drop files. Watch memory form.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-500">
              Upload files, paste a public GitHub repo URL, or both — then watch context become a navigable, agent-readable brain with a live build trace.
            </p>
          </div>

          <DocumentDropzone
            docs={docs}
            isDragging={isDragging}
            isRunning={isRunning}
            onBrowse={() => inputRef.current?.click()}
            onRemove={(id) => setDocs((prev) => prev.filter((doc) => doc.id !== id))}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            variant="hero"
          />

          <div className="mt-5 w-full max-w-3xl rounded-[2rem] border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                <GitBranch size={16} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">GitHub repository</p>
                <p className="text-xs text-slate-500">Public HTTPS links only — cloned shallow, scanned like a PDF bundle.</p>
              </div>
            </div>
            <div className="space-y-3">
              {githubRepos.map((row, index) => (
                <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="block min-w-0 flex-1">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Repo URL {githubRepos.length > 1 ? `#${index + 1}` : ""}
                    </span>
                    <input
                      type="url"
                      placeholder="https://github.com/owner/repo"
                      value={row.url}
                      disabled={isRunning}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGithubRepos((prev) => prev.map((r) => (r.id === row.id ? { ...r, url: v } : r)));
                      }}
                      className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none ring-violet-500/0 transition focus:ring-2 focus:ring-violet-500/30"
                    />
                  </label>
                  <label className="block w-full sm:w-36">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Branch (opt.)</span>
                    <input
                      type="text"
                      placeholder="main"
                      value={row.ref}
                      disabled={isRunning}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGithubRepos((prev) => prev.map((r) => (r.id === row.id ? { ...r, ref: v } : r)));
                      }}
                      className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </label>
                  {githubRepos.length > 1 && (
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => setGithubRepos((prev) => prev.filter((r) => r.id !== row.id))}
                      className="rounded-xl border border-slate-200/80 px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {githubRepos.length < 4 && (
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setGithubRepos((prev) => [...prev, newGithubRepoRow()])}
                className="mt-3 text-xs font-semibold text-violet-600 hover:text-violet-800 disabled:opacity-50"
              >
                + Add another repository
              </button>
            )}
          </div>

          <div className="mt-6 flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AgentStatus online={agentOnline} compact />
            <button
              onClick={runBootstrap}
              disabled={!hasBootstrapSource || isRunning || agentOnline === false}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all",
                hasBootstrapSource && !isRunning && agentOnline !== false
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-300/40 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-violet-400/50"
                  : "cursor-not-allowed bg-white/70 text-slate-400 ring-1 ring-slate-200/70",
              )}
            >
              <Send size={15} />
              Create Brain
            </button>
          </div>

          {error && <div className="mt-4 w-full max-w-3xl"><ErrorBanner message={error} /></div>}
        </section>
      ) : (
        <section className="mx-auto flex max-w-screen-2xl flex-col gap-5 pb-10">
          <div className="rounded-[2rem] border border-white/80 bg-white/75 p-5 shadow-sm backdrop-blur-2xl">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-violet-100 ring-1 ring-violet-200/70">
                    <Brain size={15} className="text-violet-600" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{stageLabel}</p>
                    <p className="mt-0.5 text-xs text-slate-400">Live WebSocket initialization: logs, files, graph.</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Sources in" value={sourceCount.toString()} />
                <Metric label="Chars" value={formatCompact(totalChars)} />
                <Metric label="Brain files" value={createdFiles.length.toString()} />
              </div>
            </div>
            <BootstrapTimeline current={stage} completed={completedStages} />
          </div>

          <div className="grid gap-5">
            <div className="min-h-[640px] rounded-[2.25rem] border border-white/80 bg-white/80 p-5 shadow-2xl shadow-violet-200/30 backdrop-blur-2xl">
              <div className="flex h-full min-h-0 flex-col">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Network size={15} className="text-violet-500" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">Construction Graph</h2>
                      <p className="text-xs text-slate-500">Directories, markdown nodes, and retrieval links appear as the agent builds them</p>
                    </div>
                  </div>
                  <div className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                    isDone
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-violet-200 bg-violet-50 text-violet-700",
                  )}>
                    {isDone ? <CheckCircle2 size={12} /> : <Loader2 size={12} className="animate-spin" />}
                    {isDone ? "Ready" : "Building"}
                  </div>
                </div>
                <BootstrapLiveGraph files={createdFiles} isRunning={isRunning} />
              </div>
            </div>

            <div className="grid min-h-[420px] gap-5 lg:grid-cols-[1fr_1.05fr]">
              <BrainDirectoryTree tree={tree} files={createdFiles} />
              <AgentThinkingStream thinking={thinking} endRef={thinkingEndRef} />
            </div>
          </div>
        </section>
      )}

      {isDone && (
        <CompletionBar resultText={resultText} onReset={resetRun} />
      )}
    </main>
  );
}

function DocumentDropzone({
  docs,
  isDragging,
  isRunning,
  variant = "panel",
  onBrowse,
  onRemove,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  docs: UploadDoc[];
  isDragging: boolean;
  isRunning: boolean;
  variant?: "hero" | "panel";
  onBrowse: () => void;
  onRemove: (id: string) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const isHero = variant === "hero";
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "w-full border border-dashed bg-white/60 shadow-sm backdrop-blur-2xl transition-all duration-500",
        isHero ? "max-w-3xl rounded-[2.5rem] p-5" : "rounded-[2rem] p-4",
        isDragging ? "scale-[1.01] border-violet-400 bg-violet-50/80 shadow-2xl shadow-violet-200/50" : "border-slate-200/80",
      )}
    >
      <button
        type="button"
        onClick={onBrowse}
        disabled={isRunning}
        className={cn(
          "group relative flex w-full flex-col items-center justify-center overflow-hidden border border-white/80 bg-gradient-to-b from-violet-50/80 to-white/80 text-center transition hover:from-violet-100/80 disabled:opacity-60",
          isHero ? "min-h-[360px] rounded-[2rem] px-8 py-12" : "rounded-[1.5rem] px-5 py-8",
        )}
      >
        <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300/20 blur-3xl" />
        </div>
        <div className={cn(
          "relative flex items-center justify-center rounded-3xl bg-violet-100 ring-1 ring-violet-200/70 transition-transform duration-300 group-hover:scale-105",
          isHero ? "h-20 w-20" : "h-14 w-14",
        )}>
          <Upload size={isHero ? 32 : 22} className="text-violet-600" />
        </div>
        <p className={cn("relative mt-5 font-semibold text-slate-900", isHero ? "text-2xl" : "text-sm")}>
          Drop files here
        </p>
        <p className={cn("relative mt-2 max-w-md leading-6 text-slate-500", isHero ? "text-sm" : "text-xs")}>
          Add docs, notes, specs, code, Markdown — or use the GitHub section below. The agent turns it all into a structured brain.
        </p>
        <p className="relative mt-5 rounded-full border border-slate-200/70 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          .pdf .docx .pptx .xlsx .md .txt .json .yaml .csv .ts .tsx .py
        </p>
      </button>

      {docs.length > 0 && (
        <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/60 bg-white/80 px-3 py-2.5">
              <div className={cn(
                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl",
                doc.status === "distilled" ? "bg-emerald-100" : doc.status === "scanned" ? "bg-blue-100" : "bg-slate-100",
              )}>
                {doc.status === "distilled"
                  ? <CheckCircle2 size={14} className="text-emerald-600" />
                  : <FileText size={14} className={doc.status === "scanned" ? "text-blue-600" : "text-slate-500"} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-700">{doc.name}</p>
                <p className="text-[10px] text-slate-400">
                  {doc.text ? `${formatNumber(doc.chars)} chars` : formatBytes(doc.size)} - {doc.status}
                </p>
              </div>
              {!isRunning && (
                <button onClick={() => onRemove(doc.id)} className="rounded-lg p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BootstrapTimeline({ current, completed }: { current: StageId; completed: number }) {
  return (
    <div className="grid gap-2 md:grid-cols-6">
      {STAGES.map((step, index) => {
        const active = current === step.id;
        const done = current === "done" || index < completed;
        return (
          <div key={step.id} className="relative">
            {index < STAGES.length - 1 && (
              <ChevronRight size={13} className="absolute -right-2 top-5 hidden text-slate-300 md:block" />
            )}
            <div className={cn(
              "h-full rounded-2xl border p-3 transition-all",
              done
                ? "border-emerald-200/70 bg-emerald-50/80 text-emerald-700"
                : active
                ? "border-violet-200/70 bg-violet-50/80 text-violet-700 shadow-sm"
                : "border-slate-200/60 bg-white/70 text-slate-400",
            )}>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  done ? "bg-emerald-100" : active ? "bg-violet-100" : "bg-slate-100",
                )}>
                  {done ? <CheckCircle2 size={11} /> : index + 1}
                </span>
                <p className="text-xs font-semibold">{step.label}</p>
              </div>
              <p className="mt-1 text-[10px] opacity-70">{step.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BootstrapLiveGraph({
  files,
  isRunning,
}: {
  files: CreatedFile[];
  isRunning: boolean;
}) {
  const arrivalRef = useRef<Map<string, number>>(new Map());
  const startRef = useRef<number>(0);

  if (files.length > 0 && startRef.current === 0) startRef.current = Date.now();

  for (const f of files) {
    if (!arrivalRef.current.has(f.path)) {
      arrivalRef.current.set(f.path, Date.now());
    }
  }

  const visible = files.slice(0, 24);
  const doneCount = visible.filter((f) => f.status === "done").length;
  const dirSet = new Set(visible.map((f) => directoryOf(f.path)));
  const dirNames = Array.from(dirSet);

  const W = 920;
  const BRAIN_Y = 48;
  const DIR_Y = 155;
  const FILE_Y0 = 270;
  const FILE_ROW = 62;
  const PAD = 80;
  const COL_GAP = 90;

  const NODE_STAGGER = 0.35;
  const DIR_STAGGER = 0.5;
  const LINK_STAGGER = 0.25;
  const POP_DUR = 0.7;
  const DRAW_DUR = 0.8;

  const dirX = new Map<string, number>();
  if (dirNames.length <= 1) {
    dirNames.forEach((d) => dirX.set(d, W / 2));
  } else {
    const span = W - PAD * 2;
    const gap = span / (dirNames.length - 1);
    dirNames.forEach((d, i) => dirX.set(d, PAD + i * gap));
  }

  const byDir = new Map<string, CreatedFile[]>();
  for (const f of visible) {
    const d = directoryOf(f.path);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(f);
  }

  const dirOrder = new Map<string, number>();
  dirNames.forEach((d, i) => dirOrder.set(d, i));

  type FNode = { file: CreatedFile; x: number; y: number; order: number };
  const fnodes: FNode[] = [];
  let order = 0;
  for (const f of visible) {
    const d = directoryOf(f.path);
    const cx = dirX.get(d) ?? W / 2;
    const sibs = byDir.get(d)!;
    const si = sibs.indexOf(f);
    const cols = sibs.length > 4 ? 2 : 1;
    const col = si % cols;
    const row = Math.floor(si / cols);
    const x = cx + (col - (cols - 1) / 2) * COL_GAP;
    const y = FILE_Y0 + row * FILE_ROW;
    fnodes.push({ file: f, x, y, order: order++ });
  }

  let maxRows = 1;
  byDir.forEach((children) => {
    const c = children.length > 4 ? 2 : 1;
    maxRows = Math.max(maxRows, Math.ceil(children.length / c));
  });
  const H = Math.max(440, FILE_Y0 + maxRows * FILE_ROW + 50);

  const hasBrain = visible.length > 0;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-slate-200/60 bg-gradient-to-b from-slate-50 to-white">
      <div className="pointer-events-none absolute inset-0 opacity-[.18] [background-image:radial-gradient(circle,rgba(148,163,184,.18)_1px,transparent_1px)] [background-size:22px_22px]" />

      <div className="pointer-events-none absolute left-4 top-4 z-10 flex gap-2">
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 shadow-sm backdrop-blur">
          {hasBrain ? `${dirNames.length} dir · ${visible.length} nodes` : "Waiting"}
        </span>
        {doneCount > 0 && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700 shadow-sm backdrop-blur">
            {doneCount} linked
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <style>{`
            @keyframes cg-pop{
              0%{opacity:0;transform:scale(0)}
              50%{opacity:1;transform:scale(1.06)}
              75%{transform:scale(.98)}
              100%{opacity:1;transform:scale(1)}
            }
            @keyframes cg-ring{0%,100%{opacity:.25}50%{opacity:.06}}
            @keyframes cg-draw{from{stroke-dashoffset:300}to{stroke-dashoffset:0}}
            @keyframes cg-flow{to{stroke-dashoffset:-14}}
            @keyframes cg-pulse{0%,100%{r:22;opacity:.18}50%{r:28;opacity:.06}}
            @keyframes cg-fade-in{from{opacity:0}to{opacity:1}}
            .cg-pop{transform-box:fill-box;transform-origin:center;animation:cg-pop ${POP_DUR}s cubic-bezier(.16,1,.3,1) both}
            .cg-draw{stroke-dasharray:300;animation:cg-draw ${DRAW_DUR}s cubic-bezier(.4,0,.2,1) both}
            .cg-flow{stroke-dasharray:5 4;animation:cg-flow .7s linear infinite}
            .cg-ring{animation:cg-pulse 1.8s ease-in-out infinite}
            .cg-fade{animation:cg-fade-in .5s ease-out both}
          `}</style>
        </defs>

        {hasBrain ? (
          <>
            {/* brain root node */}
            <g className="cg-pop" style={{ animationDelay: "0s" }}>
              <circle cx={W / 2} cy={BRAIN_Y} r="22" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2.2" />
              <circle cx={W / 2} cy={BRAIN_Y} r="6" fill="#7c3aed" />
              <text x={W / 2} y={BRAIN_Y + 40} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="ui-sans-serif,system-ui,sans-serif" fill="#4c1d95">
                brain/
              </text>
            </g>

            {/* curves from brain root to directories */}
            {dirNames.map((d, i) => {
              const dx = dirX.get(d)!;
              const midY = (BRAIN_Y + DIR_Y) / 2 + 12;
              const delay = 0.3 + i * DIR_STAGGER;
              return (
                <path
                  key={`br-${d}`}
                  d={`M${W / 2},${BRAIN_Y + 22} C${W / 2},${midY} ${dx},${midY} ${dx},${DIR_Y - 18}`}
                  fill="none"
                  stroke="#c7d2fe"
                  strokeWidth="1.5"
                  className="cg-draw"
                  style={{ animationDelay: `${delay}s` }}
                />
              );
            })}

            {/* directory nodes */}
            {dirNames.map((d, i) => {
              const dx = dirX.get(d)!;
              const w = Math.max(80, d.length * 8 + 28);
              const delay = 0.4 + i * DIR_STAGGER;
              return (
                <g key={`d-${d}`} className="cg-pop" style={{ animationDelay: `${delay}s` }}>
                  <rect x={dx - w / 2} y={DIR_Y - 16} width={w} height="32" rx="10" fill="white" stroke="#a5b4fc" strokeWidth="1.4" />
                  <text x={dx} y={DIR_Y + 5} textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="ui-sans-serif,system-ui,sans-serif" fill="#4338ca">
                    {d}
                  </text>
                </g>
              );
            })}

            {/* connector lines from directory to file node */}
            {fnodes.map(({ file, x, y, order: o }) => {
              const d = directoryOf(file.path);
              const dx = dirX.get(d) ?? W / 2;
              const done = file.status === "done";
              const writ = file.status === "writing";
              const dIdx = dirOrder.get(d) ?? 0;
              const baseDelay = 0.6 + dIdx * DIR_STAGGER;
              const delay = baseDelay + o * LINK_STAGGER;
              return (
                <line
                  key={`ln-${file.path}`}
                  x1={dx}
                  y1={DIR_Y + 18}
                  x2={x}
                  y2={y - 14}
                  stroke={done ? "#86efac" : writ ? "#c4b5fd" : "#e2e8f0"}
                  strokeWidth={writ ? 1.8 : 1.2}
                  strokeDasharray={done ? "none" : "5 5"}
                  className={writ ? "cg-flow" : "cg-draw"}
                  style={!writ ? { animationDelay: `${delay}s` } : undefined}
                />
              );
            })}

            {/* file nodes */}
            {fnodes.map(({ file, x, y, order: o }) => {
              const writ = file.status === "writing";
              const done = file.status === "done";
              const planned = file.status === "planned";
              const special = file.path === "index.md" || file.path === "map.md";
              const r = special ? 14 : 11;
              const name = file.path.split("/").pop()?.replace(".md", "") ?? "";
              const d = directoryOf(file.path);
              const dIdx = dirOrder.get(d) ?? 0;
              const baseDelay = 0.7 + dIdx * DIR_STAGGER;
              const delay = baseDelay + o * NODE_STAGGER;
              return (
                <g key={file.path} className="cg-pop" style={{ animationDelay: `${delay}s` }}>
                  {writ && (
                    <circle cx={x} cy={y} r="22" fill="none" stroke="#8b5cf6" strokeWidth="1.5" className="cg-ring" opacity="0.3" />
                  )}
                  <circle
                    cx={x} cy={y} r={r}
                    fill={done ? "#ecfdf5" : writ ? "#f5f3ff" : planned ? "#fafafe" : "#f8fafc"}
                    stroke={special ? "#fbbf24" : done ? "#34d399" : writ ? "#a78bfa" : "#cbd5e1"}
                    strokeWidth={writ ? 2.2 : 1.5}
                  />
                  <circle
                    cx={x} cy={y} r="3"
                    fill={special ? "#f59e0b" : done ? "#10b981" : writ ? "#8b5cf6" : "#94a3b8"}
                  />
                  <text
                    x={x} y={y + r + 14}
                    textAnchor="middle" fontSize="8" fontWeight="600"
                    fontFamily="ui-monospace,SFMono-Regular,monospace"
                    className="cg-fade"
                    style={{ animationDelay: `${delay + 0.15}s` }}
                    fill={done ? "#059669" : writ ? "#6d28d9" : "#64748b"}
                  >
                    {name.length > 14 ? name.slice(0, 13) + "\u2026" : name}
                  </text>
                </g>
              );
            })}
          </>
        ) : (
          <GraphWaitingPlaceholder isRunning={isRunning} />
        )}
      </svg>
    </div>
  );
}

function GraphWaitingPlaceholder({ isRunning }: { isRunning: boolean }) {
  return (
    <g>
      <circle
        cx="460"
        cy="200"
        r="30"
        fill="#ede9fe"
        stroke="#8b5cf6"
        strokeWidth="2"
        className="cg-pop"
      >
        {isRunning && (
          <animate
            attributeName="r"
            values="30;36;30"
            dur="2s"
            repeatCount="indefinite"
          />
        )}
      </circle>
      <circle cx="460" cy="200" r="7" fill="#7c3aed" className="cg-pop" />
      <text
        x="460"
        y="248"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fontFamily="ui-sans-serif,system-ui,sans-serif"
        fill="#64748b"
      >
        {isRunning ? "Planning brain structure\u2026" : "Waiting for files"}
      </text>
    </g>
  );
}

function BrainDirectoryTree({ tree, files }: { tree: BrainTreeNode[]; files: CreatedFile[] }) {
  return (
    <div className="flex min-h-0 flex-col rounded-[2rem] border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={15} className="text-emerald-500" />
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Brain Directory</h2>
            <p className="text-xs text-slate-400">Created files appear as they are written</p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
          {files.length} files
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200/60 bg-slate-50/70 p-3">
        {tree.length ? tree.map((node) => <TreeNode key={node.path} node={node} depth={0} />) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400">
            <Folder size={24} className="mb-2 opacity-40" />
            <p className="text-xs font-medium">Waiting for generated brain files</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({ node, depth }: { node: BrainTreeNode; depth: number }) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition",
          node.type === "directory" ? "bg-amber-50/60" : "hover:bg-white/80",
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {node.type === "directory" ? <Folder size={13} className="text-amber-500" /> : <FileText size={13} className="text-emerald-500" />}
        <span className={node.type === "directory" ? "font-semibold text-slate-700" : "font-mono text-slate-600"}>
          {node.name}
        </span>
        {node.type === "file" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      </div>
      {node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}
    </div>
  );
}

function AgentThinkingStream({ thinking, endRef }: { thinking: string[]; endRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex min-h-0 flex-col rounded-[2rem] border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2">
        <Bot size={15} className="text-violet-500" />
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Agent Logs</h2>
          <p className="text-xs text-slate-400">Every initialization step streamed live</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl border border-violet-100/70 bg-violet-50/40 p-3">
        {thinking.map((line, index) => (
          <div key={`${line}-${index}`} className="flex gap-2 rounded-xl bg-white/70 px-3 py-2 text-[12px] leading-5 text-slate-600">
            <Sparkles size={11} className="mt-1 flex-shrink-0 text-violet-400" />
            <p>{line}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function AgentStatus({ online, compact = false }: { online: boolean | null; compact?: boolean }) {
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-[1.5rem] border p-4 shadow-sm backdrop-blur-xl",
      compact && "w-full sm:w-auto sm:min-w-72",
      online === true
        ? "border-emerald-200/60 bg-emerald-50/80"
        : online === false
        ? "border-amber-200/60 bg-amber-50/80"
        : "border-slate-200/60 bg-white/70",
    )}>
      {online === null ? <Loader2 size={15} className="mt-0.5 animate-spin text-slate-400" /> : online ? <Wifi size={15} className="mt-0.5 text-emerald-600" /> : <WifiOff size={15} className="mt-0.5 text-amber-600" />}
      <div>
        <p className={cn("text-xs font-semibold", online ? "text-emerald-700" : online === false ? "text-amber-800" : "text-slate-600")}>
          {online === null ? "Checking agent API" : online ? "Agent API connected" : "Agent API offline"}
        </p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          {online === false ? "Start it with `cd agent && uv run brain-api` or run `./start.sh`." : "The session builder streams initialization over a WebSocket."}
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[1.5rem] border border-red-200/60 bg-red-50/80 p-4 text-red-700 shadow-sm backdrop-blur-xl">
      <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold">Session failed</p>
        <p className="mt-1 text-[11px] leading-4">{message}</p>
      </div>
    </div>
  );
}

function CompletionBar({ resultText, onReset }: { resultText: string; onReset: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-emerald-200/70 bg-white/85 px-6 py-4 shadow-2xl shadow-emerald-900/10 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 ring-1 ring-emerald-200/70">
          <CheckCircle2 size={22} className="text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Brain ready for the demo</p>
          <p className="truncate text-xs text-slate-500">{resultText || "Your generated brain is ready to inspect and query."}</p>
        </div>
        <button onClick={onReset} className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
          New session
        </button>
        <Link href="/brain" className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-200/70 transition hover:bg-emerald-700">
          <Brain size={13} />
          Open Brain
        </Link>
        <Link href="/agent" className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-200/70 transition hover:bg-violet-700">
          <Cpu size={13} />
          Watch Agent
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white/70 p-3">
      <p className="text-2xl font-bold tabular-nums text-slate-800">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  );
}

function extensionOf(name: string) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function upsertFile(files: CreatedFile[], next: CreatedFile) {
  const existingIndex = files.findIndex((file) => file.path === next.path);
  if (existingIndex === -1) return [...files, next];
  return files.map((file, index) =>
    index === existingIndex
      ? {
          ...file,
          ...next,
          title: next.title ?? file.title,
          preview: next.preview ?? file.preview,
          links: next.links ?? file.links,
        }
      : file,
  );
}

function directoryOf(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "brain";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function resolveBootstrapWsUrl() {
  if (process.env.NEXT_PUBLIC_AGENT_WS_URL) return process.env.NEXT_PUBLIC_AGENT_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:8000/bootstrap/ws`;
}

function stageTitle(stage: StageId) {
  return STAGES.find((item) => item.id === stage)?.label ?? stage;
}
