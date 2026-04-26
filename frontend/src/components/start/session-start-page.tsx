"use client";

import Link from "next/link";
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

import {
  buildGhostScaffoldFiles,
  chunkGhostBatches,
  parseRepoSlugFromUrl,
} from "@/lib/brain/bootstrap-scaffold";
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
  /** Predicted layout while GitHub POST is in flight; replaced by real files on response. */
  isGhost?: boolean;
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
  { id: "upload", label: "Connect", desc: "Repo URL + optional files" },
  { id: "normalize", label: "Scan", desc: "Read codebase context" },
  { id: "distill", label: "Distill", desc: "Extract durable facts" },
  { id: "write", label: "Write", desc: "Create brain files" },
  { id: "index", label: "Index", desc: "Warm retrieval" },
  { id: "verify", label: "Verify", desc: "Confirm readiness" },
];

const INITIAL_NODES: GraphNode[] = [
  { id: "documents", label: "Codebase & sources", status: "idle" },
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
  const [docs, setDocs] = useState<UploadDoc[]>([]);
  const [githubRepos, setGithubRepos] = useState<GithubRepoFormRow[]>(() => [newGithubRepoRow()]);
  const prompt =
    "Build a transparent AI brain for this codebase from the linked GitHub repository (and any optional uploaded documents). Focus on architecture, entry points, dependencies, and how the system fits together.";
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [stage, setStage] = useState<StageId>("upload");
  const [stageLabel, setStageLabel] = useState("Add a GitHub repo URL to start");
  const [, setNodes] = useState<GraphNode[]>(INITIAL_NODES);
  const [, setEdges] = useState<GraphEdge[]>(INITIAL_EDGES);
  const [tree, setTree] = useState<BrainTreeNode[]>([]);
  const [createdFiles, setCreatedFiles] = useState<CreatedFile[]>([]);
  const [thinking, setThinking] = useState<string[]>([
    "Paste a public GitHub repo URL to bootstrap a brain from the codebase. Extra PDFs or notes are optional.",
  ]);
  const [resultText, setResultText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const thinkingEndRef = useRef<HTMLDivElement>(null);
  /** Browser timer ids (number); avoid NodeJS.Timeout from global setInterval typing. */
  const restBootstrapTimersRef = useRef<number[]>([]);
  const restProgressIntervalRef = useRef<number | null>(null);
  const restFetchDoneRef = useRef(false);

  const [githubRestPipeline, setGithubRestPipeline] = useState(false);
  const [restProgress, setRestProgress] = useState(0);

  const cleanupRestBootstrap = useCallback(() => {
    restBootstrapTimersRef.current.forEach((id) => window.clearTimeout(id));
    restBootstrapTimersRef.current = [];
    if (restProgressIntervalRef.current != null) {
      window.clearInterval(restProgressIntervalRef.current);
      restProgressIntervalRef.current = null;
    }
    restFetchDoneRef.current = false;
    setGithubRestPipeline(false);
    setRestProgress(0);
  }, []);

  useEffect(() => () => cleanupRestBootstrap(), [cleanupRestBootstrap]);

  const totalChars = useMemo(() => docs.reduce((sum, doc) => sum + doc.chars, 0), [docs]);
  const githubApiList = useMemo(() => githubReposForApi(githubRepos), [githubRepos]);
  const hasBootstrapSource = docs.length > 0 || githubApiList.length > 0;
  const githubOnlyBootstrap = docs.length === 0 && githubApiList.length > 0;
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

  const resetRun = useCallback(() => {
    cleanupRestBootstrap();
    socketRef.current?.close();
    socketRef.current = null;
    setIsRunning(false);
    setIsDone(false);
    setError(null);
    setStage("upload");
    setStageLabel("Add a GitHub repo URL to start");
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setTree([]);
    setCreatedFiles([]);
    setResultText("");
    setThinking([
      "Paste a public GitHub repo URL to bootstrap a brain from the codebase. Extra PDFs or notes are optional.",
    ]);
    setDocs((prev) => prev.map((doc) => ({ ...doc, status: "ready" })));
    setGithubRepos([newGithubRepoRow()]);
  }, [cleanupRestBootstrap]);

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
    setTree([]);
    setCreatedFiles([]);
    setResultText("");

    if (githubOnlyBootstrap) {
      const scheduleRest = (ms: number, fn: () => void) => {
        const id = window.setTimeout(fn, ms) as unknown as number;
        restBootstrapTimersRef.current.push(id);
      };

      cleanupRestBootstrap();
      setGithubRestPipeline(true);
      setRestProgress(6);
      setNodes(INITIAL_NODES);
      setEdges(INITIAL_EDGES);
      setStage("normalize");
      setStageLabel("Hand-off to brain agent…");
      setThinking([
        "Starting the GitHub → brain pipeline. Your repo is being shallow-cloned and scanned server-side—this story plays out in real time below.",
        githubApiList.length === 1
          ? `Repository: ${githubApiList[0]!.repo_url}`
          : `${githubApiList.length} repositories will be processed in order.`,
      ]);

      const narrativeBeats: { t: number; stage: StageId; label: string; line: string }[] = [
        { t: 400, stage: "normalize", label: "Cloning & reading the tree…", line: "Git is fetching objects; next we walk text files and rank them for context." },
        { t: 2800, stage: "normalize", label: "Ranking source excerpts…", line: "README, manifests, and high-signal paths are prioritized like an IDE index." },
        { t: 5600, stage: "distill", label: "Distilling durable facts…", line: "Noise is stripped; decisions, stack, entry points, and boundaries stay." },
        { t: 9200, stage: "write", label: "Authoring brain markdown…", line: "The model is shaping projects/, architecture, and cross-links you can browse." },
        { t: 12800, stage: "index", label: "Wiring retrieval…", line: "Sections are prepared so search and agents can use this brain immediately." },
        { t: 16800, stage: "verify", label: "Still working—large repos take longer…", line: "Hang tight; the server is still generating files. Progress below keeps moving until the response lands." },
      ];

      narrativeBeats.forEach((beat) => {
        scheduleRest(beat.t, () => {
          if (restFetchDoneRef.current) return;
          setStage(beat.stage);
          setStageLabel(beat.label);
          setThinking((prev) => [...prev, beat.line]);
        });
      });

      const slug = parseRepoSlugFromUrl(githubApiList[0]?.repo_url ?? "");
      const ghostScaffold = buildGhostScaffoldFiles(slug);
      const ghostBatches = chunkGhostBatches(ghostScaffold, 4);
      scheduleRest(350, () => {
        if (restFetchDoneRef.current) return;
        setThinking((prev) => [
          ...prev,
          "Laying out the brain directory scaffold—watch files and cross-links appear while the server still works.",
        ]);
      });
      let ghostT = 520;
      for (const batch of ghostBatches) {
        for (const g of batch) {
          const path = g.path;
          const links = g.links;
          const title = g.title;
          scheduleRest(ghostT, () => {
            if (restFetchDoneRef.current) return;
            setCreatedFiles((prev) =>
              upsertFile(prev, { path, title, status: "planned", links, isGhost: true }),
            );
          });
          scheduleRest(ghostT + 85, () => {
            if (restFetchDoneRef.current) return;
            setCreatedFiles((prev) => upsertFile(prev, { path, status: "writing", links, isGhost: true }));
          });
          scheduleRest(ghostT + 175, () => {
            if (restFetchDoneRef.current) return;
            setCreatedFiles((prev) => upsertFile(prev, { path, title, status: "done", links, isGhost: true }));
          });
          ghostT += 200;
        }
        ghostT += 90;
      }

      restProgressIntervalRef.current = window.setInterval(() => {
        if (restFetchDoneRef.current) return;
        setRestProgress((p) => Math.min(90, p + 0.35 + Math.random() * 0.9));
      }, 420) as unknown as number;

      void (async () => {
        try {
          const res = await fetch("/api/agent/initialize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              github_repos: githubApiList,
              overwrite: true,
              max_files: 20,
              apply: true,
              clone_timeout_s: 300,
            }),
          });
          const raw = (await res.json()) as { detail?: unknown; written_files?: string[]; result_text?: string };

          restFetchDoneRef.current = true;
          restBootstrapTimersRef.current.forEach((tid) => window.clearTimeout(tid));
          restBootstrapTimersRef.current = [];
          if (restProgressIntervalRef.current != null) {
            window.clearInterval(restProgressIntervalRef.current);
            restProgressIntervalRef.current = null;
          }

          if (!res.ok) {
            setRestProgress(0);
            setGithubRestPipeline(false);
            setCreatedFiles([]);
            setError(formatInitializeErrorDetail(raw, res.status));
            setIsRunning(false);
            setStage("upload");
            setStageLabel("Add a GitHub repo URL to start");
            return;
          }

          const written = Array.isArray(raw.written_files) ? raw.written_files : [];
          const writtenSet = new Set(written);
          if (written.length > 0) {
            setCreatedFiles((prev) => prev.filter((f) => !f.isGhost || writtenSet.has(f.path)));
          }
          setRestProgress(96);
          setStage("write");
          setStageLabel("Materializing brain files on the canvas…");
          setThinking((prev) => [
            ...prev,
            `Response received. Animating ${written.length} file${written.length === 1 ? "" : "s"} into the construction graph.`,
          ]);

          let delay = 320;
          const step = 155;
          for (const path of written) {
            const rel = path;
            scheduleRest(delay, () => {
              setCreatedFiles((prev) =>
                upsertFile(prev, { path: rel, title: rel.split("/").pop(), status: "planned", isGhost: false }),
              );
            });
            delay += step;
            scheduleRest(delay, () => {
              setCreatedFiles((prev) => upsertFile(prev, { path: rel, status: "writing", isGhost: false }));
            });
            delay += step;
            scheduleRest(delay, () => {
              setCreatedFiles((prev) => upsertFile(prev, { path: rel, status: "done", isGhost: false }));
            });
            delay += step + 35;
          }

          if (written.length === 0) {
            scheduleRest(500, () => {
              setThinking((prev) => [...prev, "No new file paths were reported—check the agent logs or open the brain workspace anyway."]);
            });
          }

          scheduleRest(delay + 400, () => {
            setRestProgress(100);
            setStage("done");
            setStageLabel("Brain ready");
            setResultText(String(raw.result_text ?? ""));
            setThinking((prev) => [
              ...prev,
              `Done. ${written.length} brain file${written.length === 1 ? "" : "s"} staged. Opening the full workspace is one click away.`,
            ]);
            setIsDone(true);
            setIsRunning(false);
            setGithubRestPipeline(false);
          });
        } catch (e) {
          restFetchDoneRef.current = true;
          restBootstrapTimersRef.current.forEach((tid) => window.clearTimeout(tid));
          restBootstrapTimersRef.current = [];
          if (restProgressIntervalRef.current != null) {
            window.clearInterval(restProgressIntervalRef.current);
            restProgressIntervalRef.current = null;
          }
          setRestProgress(0);
          setGithubRestPipeline(false);
          setCreatedFiles([]);
          setError(e instanceof Error ? e.message : "Initialize request failed");
          setIsRunning(false);
          setStage("upload");
          setStageLabel("Add a GitHub repo URL to start");
        }
      })();
      return;
    }

    cleanupRestBootstrap();

    setStageLabel("Connecting to the brain agent");
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
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
        max_files: 20,
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
  }, [
    agentOnline,
    cleanupRestBootstrap,
    docs,
    githubApiList,
    githubOnlyBootstrap,
    handleBootstrapEvent,
    hasBootstrapSource,
    isRunning,
    prompt,
  ]);

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-8">
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
              Paste a repo. Get a codebase brain.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-500">
              Built for real codebases: link a public GitHub repository and we clone, scan, and distill it into a structured brain. Drop extra PDFs or notes only if you want more context.
            </p>
          </div>

          <div className="w-full max-w-3xl rounded-[2rem] border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                <GitBranch size={16} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">GitHub repository — primary</p>
                <p className="text-xs text-slate-500">
                  Public HTTPS only. One URL is enough to initialize; no uploads required. We shallow-clone and rank source files like an IDE would.
                </p>
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
            supportingFiles
          />

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
                    <p className="mt-0.5 text-xs text-slate-400">
                      {githubRestPipeline
                        ? "GitHub run: the timeline and log advance while the API works; files pop onto the graph one by one when the response returns."
                        : "Live WebSocket stream: logs, files, and graph update from the agent."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Sources in" value={sourceCount.toString()} />
                <Metric label="Chars" value={formatCompact(totalChars)} />
                <Metric label="Brain files" value={createdFiles.length.toString()} />
              </div>
            </div>
            <BootstrapTimeline current={stage} completed={completedStages} restPulse={githubRestPipeline} />
            {githubRestPipeline && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/90 via-white/80 to-sky-50/70 p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-md">
                      <GitBranch size={15} />
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">GitHub → brain</p>
                      <p className="text-[10px] text-slate-500">Clone, scan, distill—then we paint each markdown node</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-white/90 px-2.5 py-1 font-mono text-[11px] font-bold tabular-nums text-violet-700 ring-1 ring-violet-200/80">
                    {Math.min(100, Math.round(restProgress))}%
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-white/90 ring-1 ring-violet-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-500 transition-[width] duration-700 ease-out"
                    style={{ width: `${Math.min(100, restProgress)}%` }}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                  <span className="font-semibold text-violet-800">{stageLabel}</span>
                  <span className="text-slate-400"> · </span>
                  Watch the stage cards above and the agent log on the right—nothing is frozen, even during a long POST.
                </p>
              </div>
            )}
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
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                      isDone
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-violet-200 bg-violet-50 text-violet-700",
                    )}>
                      {isDone ? <CheckCircle2 size={12} /> : <Loader2 size={12} className="animate-spin" />}
                      {isDone ? "Ready" : "Building"}
                    </div>
                    {isDone && (
                      <Link
                        href="/brain"
                        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                      >
                        <Brain size={12} />
                        View brain map
                      </Link>
                    )}
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
  supportingFiles = false,
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
  /** When true, de-emphasize as optional extras (codebase URL is primary). */
  supportingFiles?: boolean;
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
          isHero && !supportingFiles ? "min-h-[360px] rounded-[2rem] px-8 py-12"
            : isHero ? "min-h-[220px] rounded-[2rem] px-6 py-8"
            : "rounded-[1.5rem] px-5 py-8",
        )}
      >
        <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300/20 blur-3xl" />
        </div>
        <div className={cn(
          "relative flex items-center justify-center rounded-3xl bg-violet-100 ring-1 ring-violet-200/70 transition-transform duration-300 group-hover:scale-105",
          isHero && !supportingFiles ? "h-20 w-20" : isHero ? "h-14 w-14" : "h-14 w-14",
        )}>
          <Upload size={isHero && !supportingFiles ? 32 : 22} className="text-violet-600" />
        </div>
        <p className={cn("relative mt-5 font-semibold text-slate-900", isHero && !supportingFiles ? "text-2xl" : isHero ? "text-lg" : "text-sm")}>
          {supportingFiles ? "Extra files (optional)" : "Drop files here"}
        </p>
        <p className={cn("relative mt-2 max-w-md leading-6 text-slate-500", isHero ? "text-sm" : "text-xs")}>
          {supportingFiles
            ? "Specs, PDFs, meeting notes, or loose Markdown — skip this if the GitHub repo above is enough."
            : "Add docs, notes, specs, code, Markdown. The agent turns them into a structured brain."}
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

function BootstrapTimeline({
  current,
  completed,
  restPulse = false,
}: {
  current: StageId;
  completed: number;
  restPulse?: boolean;
}) {
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
              "h-full rounded-2xl border p-3 transition-all duration-500",
              done
                ? "border-emerald-200/70 bg-emerald-50/80 text-emerald-700"
                : active
                ? "border-violet-200/70 bg-violet-50/80 text-violet-700 shadow-sm"
                : "border-slate-200/60 bg-white/70 text-slate-400",
              restPulse && active && !done && "ring-2 ring-violet-400/60 ring-offset-2 ring-offset-violet-50/80 shadow-[0_0_20px_rgba(139,92,246,0.2)]",
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
  useEffect(() => {
    if (files.length > 0 && startRef.current === 0) startRef.current = Date.now();
    for (const f of files) {
      if (!arrivalRef.current.has(f.path)) {
        arrivalRef.current.set(f.path, Date.now());
      }
    }
  }, [files]);

  const visible = files.slice(0, 28);
  const doneCount = visible.filter((f) => f.status === "done" && !f.isGhost).length;
  const dirSet = new Set(visible.map((f) => directoryOf(f.path)));
  const dirNames = Array.from(dirSet).sort((a, b) => {
    if (a === "brain") return -1;
    if (b === "brain") return 1;
    return a.localeCompare(b);
  });

  const VIEW_MIN = 920;
  const BRAIN_Y = 48;
  const DIR_Y = 158;
  const FILE_Y0 = 272;
  const FILE_ROW = 76;

  const NODE_STAGGER = 0.35;
  const DIR_STAGGER = 0.5;
  const LINK_STAGGER = 0.25;
  const POP_DUR = 0.7;
  const DRAW_DUR = 0.8;

  const { width: W, dirX, pillHalfW } = layoutBootstrapDirectoryRow(dirNames, VIEW_MIN);

  const byDir = new Map<string, CreatedFile[]>();
  for (const f of visible) {
    const d = directoryOf(f.path);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(f);
  }

  const dirOrder = new Map<string, number>();
  dirNames.forEach((d, i) => dirOrder.set(d, i));

  function fileGridCols(n: number): number {
    if (n <= 6) return 1;
    if (n <= 14) return 2;
    return 3;
  }

  function fileColGap(cols: number): number {
    if (cols <= 1) return 0;
    if (cols === 2) return 96;
    return 82;
  }

  type FNode = { file: CreatedFile; x: number; y: number; order: number };
  const fnodes: FNode[] = [];
  let order = 0;
  for (const f of visible) {
    const d = directoryOf(f.path);
    const cx = dirX.get(d) ?? W / 2;
    const sibs = byDir.get(d)!;
    const si = sibs.indexOf(f);
    const cols = fileGridCols(sibs.length);
    const colGap = fileColGap(cols);
    const col = si % cols;
    const row = Math.floor(si / cols);
    const x = cx + (col - (cols - 1) / 2) * colGap;
    const y = FILE_Y0 + row * FILE_ROW;
    fnodes.push({ file: f, x, y, order: order++ });
  }

  const posByPath = new Map<string, FNode>(fnodes.map((fn) => [fn.file.path, fn]));
  const crossLinks: { from: FNode; to: FNode; ghostly: boolean }[] = [];
  const linkSeen = new Set<string>();
  for (const fn of fnodes) {
    for (const tp of fn.file.links ?? []) {
      const toNode = posByPath.get(tp);
      if (!toNode) continue;
      const a = fn.file.path;
      const b = toNode.file.path;
      const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
      if (linkSeen.has(key)) continue;
      linkSeen.add(key);
      crossLinks.push({ from: fn, to: toNode, ghostly: Boolean(fn.file.isGhost || toNode.file.isGhost) });
    }
  }

  let maxRows = 1;
  byDir.forEach((children) => {
    const c = fileGridCols(children.length);
    maxRows = Math.max(maxRows, Math.ceil(children.length / c));
  });
  const H = Math.max(480, FILE_Y0 + maxRows * FILE_ROW + 64);

  const hasBrain = visible.length > 0;

  return (
    <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-[1.75rem] border border-slate-200/60 bg-gradient-to-b from-slate-50 to-white">
      <div className="pointer-events-none absolute inset-0 opacity-[.18] [background-image:radial-gradient(circle,rgba(148,163,184,.18)_1px,transparent_1px)] [background-size:22px_22px]" />

      <div className="pointer-events-none absolute left-4 top-4 z-10 flex gap-2">
        <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 shadow-sm backdrop-blur">
          {hasBrain ? `${dirNames.length} dir · ${visible.length} nodes` : "Waiting"}
        </span>
        {doneCount > 0 && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700 shadow-sm backdrop-blur">
            {doneCount} materialized
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
              const pull = (dx - W / 2) * 0.22;
              const c1x = W / 2 + pull;
              const c2x = dx - pull * 0.35;
              return (
                <path
                  key={`br-${d}`}
                  d={`M${W / 2},${BRAIN_Y + 22} C${c1x},${midY} ${c2x},${midY} ${dx},${DIR_Y - 18}`}
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
              const hw = pillHalfW.get(d) ?? Math.max(40, d.length * 5.6 + 24);
              const w = hw * 2;
              const delay = 0.4 + i * DIR_STAGGER;
              return (
                <g key={`d-${d}`} className="cg-pop" style={{ animationDelay: `${delay}s` }}>
                  <title>{`${d}/`}</title>
                  <rect x={dx - hw} y={DIR_Y - 16} width={w} height="32" rx="10" fill="white" stroke="#a5b4fc" strokeWidth="1.4" />
                  <text x={dx} y={DIR_Y + 5} textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="ui-sans-serif,system-ui,sans-serif" fill="#4338ca">
                    {d.length > 18 ? `${d.slice(0, 16)}\u2026` : d}
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
              const ghost = file.isGhost === true;
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
                  stroke={ghost ? "#ddd6fe" : done ? "#86efac" : writ ? "#c4b5fd" : "#e2e8f0"}
                  strokeWidth={writ ? 1.8 : 1.2}
                  strokeDasharray={ghost ? "4 4" : done ? "none" : "5 5"}
                  opacity={ghost ? 0.65 : 1}
                  className={writ ? "cg-flow" : "cg-draw"}
                  style={!writ ? { animationDelay: `${delay}s` } : undefined}
                />
              );
            })}

            {crossLinks.map(({ from, to, ghostly }, li) => {
              const { x: x1, y: y1 } = from;
              const { x: x2, y: y2 } = to;
              const dx = x2 - x1;
              const dy = y2 - y1;
              const dist = Math.hypot(dx, dy) || 1;
              const off = Math.min(36, 14 + dist * 0.08);
              const midX = (x1 + x2) / 2 - (dy / dist) * off;
              const midY = (y1 + y2) / 2 + (dx / dist) * off * 0.55;
              const delay = 0.82 + li * 0.035;
              return (
                <path
                  key={`xlink-${from.file.path}-${to.file.path}`}
                  d={`M${x1},${y1} Q${midX},${midY} ${x2},${y2}`}
                  fill="none"
                  stroke={ghostly ? "#c4b5fd" : "#34d399"}
                  strokeWidth={ghostly ? 1 : 1.25}
                  strokeDasharray={ghostly ? "5 4" : "7 4"}
                  opacity={ghostly ? 0.5 : 0.78}
                  strokeLinecap="round"
                  className="cg-draw"
                  style={{ animationDelay: `${delay}s` }}
                />
              );
            })}

            {/* file nodes */}
            {fnodes.map(({ file, x, y, order: o }) => {
              const writ = file.status === "writing";
              const done = file.status === "done";
              const planned = file.status === "planned";
              const ghost = file.isGhost === true;
              const special = file.path === "index.md" || file.path === "map.md";
              const r = special ? 14 : 11;
              const baseName = file.path.split("/").pop()?.replace(/\.mdx?$/i, "") ?? "";
              const name = truncateFileLabel(baseName, 17);
              const d = directoryOf(file.path);
              const dIdx = dirOrder.get(d) ?? 0;
              const baseDelay = 0.7 + dIdx * DIR_STAGGER;
              const delay = baseDelay + o * NODE_STAGGER;
              return (
                <g key={file.path} className="cg-pop" style={{ animationDelay: `${delay}s`, opacity: ghost ? 0.82 : 1 }}>
                  <title>{file.path}</title>
                  {writ && (
                    <circle cx={x} cy={y} r="22" fill="none" stroke="#8b5cf6" strokeWidth="1.5" className="cg-ring" opacity="0.3" />
                  )}
                  <circle
                    cx={x} cy={y} r={r}
                    fill={ghost ? (done ? "#f5f3ff" : writ ? "#faf5ff" : "#fafafe") : done ? "#ecfdf5" : writ ? "#f5f3ff" : planned ? "#fafafe" : "#f8fafc"}
                    stroke={special ? "#fbbf24" : ghost ? "#a78bfa" : done ? "#34d399" : writ ? "#a78bfa" : "#cbd5e1"}
                    strokeWidth={writ ? 2.2 : 1.5}
                    strokeDasharray={ghost ? "3 3" : undefined}
                  />
                  <circle
                    cx={x} cy={y} r="3"
                    fill={special ? "#f59e0b" : ghost ? "#8b5cf6" : done ? "#10b981" : writ ? "#8b5cf6" : "#94a3b8"}
                  />
                  <text
                    x={x} y={y + r + 15}
                    textAnchor="middle" fontSize="8" fontWeight="600"
                    fontFamily="ui-monospace,SFMono-Regular,monospace"
                    className="cg-fade"
                    style={{ animationDelay: `${delay + 0.15}s` }}
                    fill={ghost ? "#7c3aed" : done ? "#059669" : writ ? "#6d28d9" : "#64748b"}
                  >
                    {name}
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

function pathsToVirtualTree(paths: string[]): BrainTreeNode[] {
  const uniq = [...new Set(paths)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const rootChildren: BrainTreeNode[] = [];
  for (const path of uniq) {
    const segments = path.split("/").filter(Boolean);
    let parentList = rootChildren;
    let acc = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      acc = acc ? `${acc}/${seg}` : seg;
      const isLeaf = i === segments.length - 1;
      let node = parentList.find((c) => c.path === acc);
      if (!node) {
        node = { name: seg, path: acc, type: isLeaf ? "file" : "directory", children: isLeaf ? undefined : [] };
        parentList.push(node);
      }
      if (!isLeaf) {
        node.children = node.children ?? [];
        parentList = node.children;
      }
    }
  }
  function sortNodes(nodes: BrainTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children?.length) sortNodes(n.children);
    }
  }
  sortNodes(rootChildren);
  return rootChildren;
}

function BrainDirectoryTree({ tree, files }: { tree: BrainTreeNode[]; files: CreatedFile[] }) {
  const virtualTree = useMemo(() => pathsToVirtualTree(files.map((f) => f.path)), [files]);
  const displayTree = tree.length > 0 ? tree : virtualTree;
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const fileCount = files.filter((f) => f.path && !f.path.endsWith("/")).length;

  return (
    <div className="flex min-h-0 flex-col rounded-[2rem] border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={15} className="text-emerald-500" />
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Brain Directory</h2>
            <p className="text-xs text-slate-400">
              {tree.length > 0 ? "Live snapshot from the agent" : "Built live from paths on the canvas (preview + real)"}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
          {fileCount} files
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200/60 bg-slate-50/70 p-3">
        {displayTree.length ? (
          displayTree.map((node) => <TreeNode key={node.path} node={node} depth={0} fileByPath={fileByPath} />)
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400">
            <Folder size={24} className="mb-2 opacity-40" />
            <p className="text-xs font-medium">Waiting for generated brain files</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  fileByPath,
}: {
  node: BrainTreeNode;
  depth: number;
  fileByPath: Map<string, CreatedFile>;
}) {
  const hint = node.type === "file" ? fileByPath.get(node.path) : undefined;
  const ghost = hint?.isGhost === true;
  const writing = hint?.status === "writing";

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition",
          node.type === "directory" ? "bg-amber-50/60" : "hover:bg-white/80",
          ghost && "border border-dashed border-violet-200/90 bg-violet-50/40",
          writing && "ring-1 ring-violet-400/50",
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {node.type === "directory" ? <Folder size={13} className="text-amber-500" /> : <FileText size={13} className={ghost ? "text-violet-500" : "text-emerald-500"} />}
        <span className={node.type === "directory" ? "font-semibold text-slate-700" : "font-mono text-slate-600"}>
          {node.name}
        </span>
        {node.type === "file" && ghost && (
          <span className="ml-auto rounded px-1 text-[9px] font-bold uppercase tracking-wide text-violet-600">preview</span>
        )}
        {node.type === "file" && !ghost && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      </div>
      {node.children?.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} fileByPath={fileByPath} />)}
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
        <p className="mt-1 whitespace-pre-line text-[11px] leading-4">{message}</p>
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
          <p className="text-sm font-semibold text-slate-800">Brain is ready</p>
          <p className="truncate text-xs text-slate-500">
            {resultText || "Stay on this screen as long as you like—open the map only when you choose."}
          </p>
        </div>
        <button onClick={onReset} className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
          New session
        </button>
        <Link href="/brain" className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-200/70 transition hover:bg-emerald-700">
          <Brain size={13} />
          View brain map
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
          isGhost: "isGhost" in next ? next.isGhost : file.isGhost,
        }
      : file,
  );
}

function directoryOf(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "brain";
}

/** Short label for SVG nodes; keeps more characters for mono filenames. */
function truncateFileLabel(s: string, max = 16): string {
  if (s.length <= max) return s;
  const inner = max - 1;
  const left = Math.ceil(inner / 2);
  const right = Math.floor(inner / 2);
  return `${s.slice(0, left)}\u2026${s.slice(s.length - right)}`;
}

/**
 * Pack directory pills on one row with minimum gaps so rounded rects do not overlap.
 * Returns canvas width ≥ viewMin when the row needs more horizontal space.
 */
function layoutBootstrapDirectoryRow(
  dirNames: string[],
  viewMin: number,
): { width: number; dirX: Map<string, number>; pillHalfW: Map<string, number> } {
  const sidePad = 44;
  const minBetween = 16;
  const pillPadX = 24;
  const halfWidths = dirNames.map((d) => Math.max(40, d.length * 5.6 + pillPadX));
  const pillHalfW = new Map<string, number>();
  dirNames.forEach((d, i) => pillHalfW.set(d, halfWidths[i]!));

  if (dirNames.length === 0) {
    return { width: viewMin, dirX: new Map(), pillHalfW };
  }
  if (dirNames.length === 1) {
    const d0 = dirNames[0]!;
    return { width: viewMin, dirX: new Map([[d0, viewMin / 2]]), pillHalfW };
  }

  const centers: number[] = [];
  let x = sidePad + halfWidths[0]!;
  centers.push(x);
  for (let i = 1; i < dirNames.length; i++) {
    x = centers[i - 1]! + halfWidths[i - 1]! + minBetween + halfWidths[i]!;
    centers.push(x);
  }
  const rawRight = centers[centers.length - 1]! + halfWidths[halfWidths.length - 1]! + sidePad;
  const width = Math.max(viewMin, Math.ceil(rawRight + 8));
  const shift = (width - rawRight) / 2;
  const dirX = new Map<string, number>();
  dirNames.forEach((d, i) => dirX.set(d, centers[i]! + shift));
  return { width, dirX, pillHalfW };
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

function formatInitializeErrorDetail(raw: { detail?: unknown }, status: number): string {
  const d = raw.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((item) => (typeof item === "object" && item && "msg" in item ? String((item as { msg: unknown }).msg) : JSON.stringify(item)))
      .join("; ");
  }
  if (d != null && typeof d === "object") return JSON.stringify(d);
  return `Initialize failed (${status})`;
}
