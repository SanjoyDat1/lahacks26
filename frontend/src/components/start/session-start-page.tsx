"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileSpreadsheet,
  FileText,
  Folder,
  GitBranch,
  Loader2,
  Mail,
  Paperclip,
  Send,
  X,
} from "lucide-react";

import { normalizeBootstrapWsUrlForBrowser } from "@/lib/bootstrap-ws-url";
import {
  buildGhostScaffoldFiles,
  chunkGhostBatches,
  parseRepoSlugFromUrl,
} from "@/lib/brain/bootstrap-scaffold";
import {
  githubReposForApi,
  type GithubRepoFormRow,
} from "@/lib/brain/github-ingest";
import {
  SessionIntegrationSources,
  type ContextImportBatch,
  type ContextPillKind,
} from "@/components/start/session-integration-sources";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

function newGithubRepoRow(): GithubRepoFormRow {
  return {
		id:
			typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `gh-${Date.now()}`,
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

type ContextBundlePill = {
  id: string;
  kind: ContextPillKind;
  label: string;
  docIds: string[];
};

function newContextPillId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pill-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function contextPillIcon(kind: ContextPillKind) {
  const cls = "h-4 w-4";
  switch (kind) {
    case "drive_folder":
      return <Folder className={cls} />;
    case "calendar":
      return <Calendar className={cls} />;
    case "sheet":
      return <FileSpreadsheet className={cls} />;
    case "gmail":
      return <Mail className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

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

type AgentFilesResponse = {
  brain_dir: string;
  source: "working" | "reference";
  files: Array<{
    path: string;
    content: string;
    frontmatter: Record<string, unknown>;
  }>;
};

type BootstrapEvent =
  | { type: "connected"; message: string }
  | { type: "stage_start"; stage: StageId; label?: string }
  | { type: "thinking"; content: string }
	| {
			type: "document";
			name: string;
			chars: number;
			status: "scanned" | "distilled";
	  }
  | { type: "graph_node"; id: string; label: string; status: GraphStatus }
  | { type: "graph_edge"; from: string; to: string; status: GraphStatus }
	| {
			type: "file_planned";
			path: string;
			title?: string;
			preview?: string;
			links?: string[];
	  }
  | { type: "file_writing"; path: string; title?: string }
  | { type: "file_created"; path: string; title?: string; preview?: string }
  | { type: "directory_snapshot"; tree: BrainTreeNode[] }
  | { type: "done"; written_files: string[]; result_text: string }
  | { type: "error"; message: string };

type StageId =
	| "upload"
	| "normalize"
	| "distill"
	| "write"
	| "index"
	| "verify"
	| "done";

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
	const [githubRepos, setGithubRepos] = useState<GithubRepoFormRow[]>(() => [
		newGithubRepoRow(),
	]);
	const [entryText, setEntryText] = useState("");
  const prompt =
    "Build our company brain from the linked GitHub repositories, uploads, and Google Workspace imports. Put each supported department or function in its own directory (company/engineering, company/finance, …), link sections to each other in the Markdown, and use map.md to visualize how the company fits together. Multiple AI agents should share one grounded org picture—decisions, metrics, owners, risks, guardrails—only what the sources support.";
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<StageId>("upload");
	const [stageLabel, setStageLabel] = useState(
		"Add a GitHub repo or uploads",
	);
  const [, setNodes] = useState<GraphNode[]>(INITIAL_NODES);
  const [, setEdges] = useState<GraphEdge[]>(INITIAL_EDGES);
  const [tree, setTree] = useState<BrainTreeNode[]>([]);
  const [createdFiles, setCreatedFiles] = useState<CreatedFile[]>([]);
  /** Live lines during bootstrap (build mode header only — no setup “session log” UI). */
  const [thinking, setThinking] = useState<string[]>([]);
  const [resultText, setResultText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  /** From GET /api/agent/stream — matches server-side AGENT_API_URL on localhost when NEXT_PUBLIC_* is unset. */
  const bootstrapWsUrlRef = useRef<string | undefined>(undefined);
  const thinkingEndRef = useRef<HTMLDivElement>(null);
  /** Browser timer ids (number); avoid NodeJS.Timeout from global setInterval typing. */
  const restBootstrapTimersRef = useRef<number[]>([]);
  const restProgressIntervalRef = useRef<number | null>(null);
  const restFetchDoneRef = useRef(false);

  const [githubRestPipeline, setGithubRestPipeline] = useState(false);
  const [restProgress, setRestProgress] = useState(0);
  const [googleAttachOpen, setGoogleAttachOpen] = useState(false);
  const [contextPills, setContextPills] = useState<ContextBundlePill[]>([]);

  const syncCreatedFilesFromAgent = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/files", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as AgentFilesResponse | { error?: string };
      if (!("files" in body) || !Array.isArray(body.files)) return;

      const nextFiles: CreatedFile[] = body.files.map((file) => ({
        path: file.path,
        title: file.path.split("/").pop() ?? file.path,
        preview:
          typeof file.content === "string" && file.content.trim().length > 0
            ? file.content.trim().slice(0, 180)
            : undefined,
        status: "done",
        isGhost: false,
      }));

      setCreatedFiles(nextFiles);
      setTree(pathsToVirtualTree(nextFiles.map((file) => file.path)));
    } catch {
      // Keep the bootstrap snapshot if the live agent isn't reachable.
    }
  }, []);

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

  useEffect(() => {
    if (!isDone || isRunning) return;

    const reloadIfVisible = () => {
      if (document.visibilityState === "visible") {
        void syncCreatedFilesFromAgent();
      }
    };

    void syncCreatedFilesFromAgent();
    const interval = window.setInterval(reloadIfVisible, 3000);
    window.addEventListener("focus", reloadIfVisible);
    document.addEventListener("visibilitychange", reloadIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", reloadIfVisible);
      document.removeEventListener("visibilitychange", reloadIfVisible);
    };
  }, [isDone, isRunning, syncCreatedFilesFromAgent]);

	const totalChars = useMemo(
		() => docs.reduce((sum, doc) => sum + doc.chars, 0),
		[docs],
	);
	const githubApiList = useMemo(
		() => githubReposForApi(githubRepos),
		[githubRepos],
	);
  const pillDocIdSet = useMemo(
    () => new Set(contextPills.flatMap((p) => p.docIds)),
    [contextPills],
  );
  const standaloneDocs = useMemo(
    () => docs.filter((d) => !pillDocIdSet.has(d.id)),
    [docs, pillDocIdSet],
  );
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
        const data = (await res.json()) as { offline?: boolean; bootstrap_ws_url?: string };
        if (!cancelled) {
          bootstrapWsUrlRef.current =
            typeof data.bootstrap_ws_url === "string" && data.bootstrap_ws_url.length > 0
              ? data.bootstrap_ws_url
              : undefined;
        }
      } catch {
        if (!cancelled) {
          bootstrapWsUrlRef.current = undefined;
        }
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
    if (!googleAttachOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGoogleAttachOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [googleAttachOpen]);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const g = sp.get("google");
    if (g === "connected") {
      setError(null);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (g === "error") {
      const msg = sp.get("message") ?? "unknown";
      setError(`Google: ${decodeURIComponent(msg)}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const appendImportBatches = useCallback(
    (batches: ContextImportBatch[]) => {
      const newPills: ContextBundlePill[] = [];
      const newDocs: UploadDoc[] = [];
      for (const batch of batches) {
        const valid = batch.documents.filter(
          (item) =>
            (item.text && item.text.trim().length > 0) ||
            (item.content_base64 && item.content_base64.trim().length > 0),
        );
        if (!valid.length) continue;
        const docIds: string[] = [];
        for (const item of valid) {
          const id = `int-${item.name}-${item.chars}-${Math.random().toString(36).slice(2, 9)}`;
          docIds.push(id);
          newDocs.push({
            id,
            name: item.name,
            text: item.text,
            content_base64: item.content_base64,
            mime_type: item.mime_type,
            size: item.size,
            chars: item.chars,
            status: "ready",
          });
        }
        newPills.push({
          id: newContextPillId(),
          kind: batch.kind,
          label: batch.label,
          docIds,
        });
      }
      if (!newPills.length) {
        return;
      }
      setError(null);
      setDocs((prev) => [...prev, ...newDocs]);
      setContextPills((prev) => [...prev, ...newPills]);
    },
    [],
  );

  const removeContextPill = useCallback((pillId: string) => {
    let drop: Set<string> | undefined;
    setContextPills((prev) => {
      const pill = prev.find((p) => p.id === pillId);
      if (!pill) return prev;
      drop = new Set(pill.docIds);
      return prev.filter((p) => p.id !== pillId);
    });
    if (drop) {
      setDocs((d) => d.filter((doc) => !drop!.has(doc.id)));
    }
  }, []);

  const removeDocOrBundle = useCallback(
    (docId: string) => {
      const pill = contextPills.find((p) => p.docIds.includes(docId));
      if (pill) {
        removeContextPill(pill.id);
        return;
      }
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    },
    [contextPills, removeContextPill],
  );

  const resetRun = useCallback(() => {
    cleanupRestBootstrap();
    socketRef.current?.close();
    socketRef.current = null;
    setIsRunning(false);
    setIsDone(false);
    setError(null);
    setStage("upload");
    setStageLabel("Add a GitHub repo or uploads");
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setTree([]);
    setCreatedFiles([]);
    setResultText("");
    setThinking([]);
    setDocs((prev) => prev.map((doc) => ({ ...doc, status: "ready" })));
    setGithubRepos([newGithubRepoRow()]);
    setContextPills([]);
    setGoogleAttachOpen(false);
		setEntryText("");
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
			const isText =
				TEXT_UPLOAD_EXTENSIONS.has(ext) ||
				file.type.startsWith("text/");
      const text = isText ? await file.text() : undefined;
			const contentBase64 = isText
				? undefined
				: await readFileAsDataUrl(file);
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
			setError(
				`Unsupported files skipped: ${unsupported.slice(0, 4).join(", ")}${unsupported.length > 4 ? "..." : ""}`,
			);
    }
    if (nextDocs.length) {
      setDocs((prev) => [...prev, ...nextDocs]);
    }
  }, []);

	const handleDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void addFiles(event.dataTransfer.files);
		},
		[addFiles],
	);

	const addGithubRepoUrls = useCallback((urls: string[]) => {
		const normalized = urls
			.map(normalizeGithubRepoUrl)
			.filter((url): url is string => Boolean(url));
		if (!normalized.length) return;

		setGithubRepos((prev) => {
			const existing = prev.filter((repo) => repo.url.trim());
			const seen = new Set(
				existing.map((repo) => repo.url.trim().toLowerCase()),
			);
			const next = [...existing];
			for (const url of normalized) {
				const key = url.toLowerCase();
				if (seen.has(key)) continue;
				next.push({ ...newGithubRepoRow(), url, ref: "" });
				seen.add(key);
				if (next.length >= 4) break;
			}
			return next.length ? next : [newGithubRepoRow()];
		});
	}, []);

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
					node.id === event.id
						? { ...node, label: event.label, status: event.status }
						: node,
        ),
      );
      return;
    }
    if (event.type === "graph_edge") {
      setEdges((prev) =>
        prev.map((edge) =>
					edge.from === event.from && edge.to === event.to
						? { ...edge, status: event.status }
						: edge,
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
    if (!hasBootstrapSource || isRunning) return;

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

      const narrativeBeats: {
        t: number;
        stage: StageId;
        label: string;
        line: string;
      }[] = [
        {
          t: 400,
          stage: "normalize",
          label: "Cloning & reading the tree…",
          line: "Git is fetching objects; next we walk text files and rank them for context.",
        },
        {
          t: 2800,
          stage: "normalize",
          label: "Ranking source excerpts…",
          line: "README, manifests, and high-signal paths are prioritized like an IDE index.",
        },
        {
          t: 5600,
          stage: "distill",
          label: "Distilling durable facts…",
          line: "Noise is stripped; decisions, stack, entry points, and boundaries stay.",
        },
        {
          t: 9200,
          stage: "write",
          label: "Authoring brain markdown…",
          line: "The model is shaping projects/, architecture, and cross-links you can browse.",
        },
        {
          t: 12800,
          stage: "index",
          label: "Wiring retrieval…",
          line: "Sections are prepared so search and agents can use this brain immediately.",
        },
        {
          t: 16800,
          stage: "verify",
          label: "Still working—large repos take longer…",
          line: "Hang tight; the server is still generating files. Progress below keeps moving until the response lands.",
        },
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
              upsertFile(prev, {
                path,
                title,
                status: "planned",
                links,
                isGhost: true,
              }),
            );
          });
          scheduleRest(ghostT + 85, () => {
            if (restFetchDoneRef.current) return;
            setCreatedFiles((prev) =>
              upsertFile(prev, { path, status: "writing", links, isGhost: true }),
            );
          });
          scheduleRest(ghostT + 175, () => {
            if (restFetchDoneRef.current) return;
            setCreatedFiles((prev) =>
              upsertFile(prev, { path, title, status: "done", links, isGhost: true }),
            );
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
              max_files: 24,
              apply: true,
              clone_timeout_s: 300,
            }),
          });
          const raw = (await res.json()) as {
            detail?: unknown;
            written_files?: string[];
            result_text?: string;
          };

          restFetchDoneRef.current = true;
          restBootstrapTimersRef.current.forEach((tid) =>
            window.clearTimeout(tid),
          );
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
            setStageLabel("Add a GitHub repo or uploads");
            return;
          }

          const written = Array.isArray(raw.written_files) ? raw.written_files : [];
          const writtenSet = new Set(written);
          if (written.length > 0) {
            setCreatedFiles((prev) =>
              prev.filter((f) => !f.isGhost || writtenSet.has(f.path)),
            );
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
                upsertFile(prev, {
                  path: rel,
                  title: rel.split("/").pop(),
                  status: "planned",
                  isGhost: false,
                }),
              );
            });
            delay += step;
            scheduleRest(delay, () => {
              setCreatedFiles((prev) =>
                upsertFile(prev, { path: rel, status: "writing", isGhost: false }),
              );
            });
            delay += step;
            scheduleRest(delay, () => {
              setCreatedFiles((prev) =>
                upsertFile(prev, { path: rel, status: "done", isGhost: false }),
              );
            });
            delay += step + 35;
          }

          if (written.length === 0) {
            scheduleRest(500, () => {
              setThinking((prev) => [
                ...prev,
                "No new file paths were reported—check the agent logs or open the brain workspace anyway.",
              ]);
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
          restBootstrapTimersRef.current.forEach((tid) =>
            window.clearTimeout(tid),
          );
          restBootstrapTimersRef.current = [];
          if (restProgressIntervalRef.current != null) {
            window.clearInterval(restProgressIntervalRef.current);
            restProgressIntervalRef.current = null;
          }
          setRestProgress(0);
          setGithubRestPipeline(false);
          setCreatedFiles([]);
          setError(
            e instanceof Error ? e.message : "Initialize request failed",
          );
          setIsRunning(false);
          setStage("upload");
          setStageLabel("Add a GitHub repo or uploads");
        }
      })();
      return;
    }

    cleanupRestBootstrap();

    void (async () => {
      try {
        const res = await fetch("/api/agent/stream");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const meta = (await res.json()) as {
          bootstrap_ws_url?: string;
          offline?: boolean;
        };
        if (meta.offline === true) {
          setError(
            "The brain agent is not running or Next.js cannot reach it. In a second terminal run: npm run brain-api (from the frontend folder) or: cd agent && uv run brain-api — then reload this page. Set AGENT_API_URL / NEXT_PUBLIC_AGENT_API_URL in .env if the API is not on port 8000.",
          );
          setIsRunning(false);
          setStage("upload");
          setStageLabel("Add a GitHub repo or uploads");
          return;
        }
        if (typeof meta.bootstrap_ws_url === "string" && meta.bootstrap_ws_url.length > 0) {
          bootstrapWsUrlRef.current = meta.bootstrap_ws_url;
        }
      } catch {
        setError(
          "Could not verify the brain agent (request to /api/agent/stream failed). Check that the Next dev server is running, then start brain-api (npm run brain-api from frontend/).",
        );
        setIsRunning(false);
        setStage("upload");
        setStageLabel("Add a GitHub repo or uploads");
        return;
      }

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

      const wsUrl = resolveBootstrapWsUrl(bootstrapWsUrlRef.current);
      const ws = new WebSocket(wsUrl);
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
        setError(
          `Could not open the bootstrap WebSocket (${wsUrl}). Start the agent on port 8000 (npm run brain-api from frontend/, or cd agent && uv run brain-api). If the UI is not on the same machine, set NEXT_PUBLIC_AGENT_API_URL to the URL your browser can reach.`,
        );
        setIsRunning(false);
      };

      ws.onclose = () => {
        setIsRunning(false);
      };
    })();
  }, [
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
    <main className={cn(
      "relative overflow-hidden",
      buildMode ? "h-screen px-4 py-3" : "min-h-screen px-6 py-8",
    )}>
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
				<section className="mx-auto flex min-h-[calc(100vh-120px)] w-full max-w-5xl flex-col items-center justify-center pb-10">
          <div className="mb-8 text-center">
            <h1 className="mt-6 text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
							What should your brain learn first?
            </h1>
						<p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-slate-500">
							Paste a GitHub URL, drop files on the box, or open the paperclip to upload files and connect
							Google Workspace (company Drive folder + calendar). Your context shows as thumbnails above the
							input—like ChatGPT attachments.
            </p>
          </div>

					<UniversalStartEntry
						text={entryText}
						standaloneDocs={standaloneDocs}
						contextPills={contextPills}
						githubRepos={githubRepos.filter((repo) => repo.url.trim().length > 0)}
						hasBootstrapSource={hasBootstrapSource}
						isDragging={isDragging}
						isRunning={isRunning}
						canSubmit={hasBootstrapSource}
						onTextChange={setEntryText}
						onPasteGithubRepos={addGithubRepoUrls}
						onBrowse={() => inputRef.current?.click()}
						onRemoveDoc={removeDocOrBundle}
						onRemoveContextPill={removeContextPill}
						onOpenGoogleWorkspace={() => setGoogleAttachOpen(true)}
						onRemoveRepo={(id) =>
							setGithubRepos((prev) => {
								const next = prev.filter(
									(repo) => repo.id !== id,
								);
								return next.length
									? next
									: [newGithubRepoRow()];
							})
						}
						onDragOver={(event) => {
							event.preventDefault();
							setIsDragging(true);
						}}
						onDragLeave={() => setIsDragging(false)}
						onDrop={handleDrop}
						onSubmit={runBootstrap}
					/>

					{googleAttachOpen ? (
						<button
							type="button"
							className="fixed inset-0 z-[60] bg-slate-950/40 backdrop-blur-[2px] transition-opacity"
							aria-label="Close Google Workspace"
							onClick={() => setGoogleAttachOpen(false)}
						/>
					) : null}
					{googleAttachOpen ? (
						<div
							className="fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-24px))] max-h-[min(640px,85vh)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.75rem] border border-slate-200/90 bg-white p-5 pb-6 pt-12 shadow-2xl shadow-slate-900/20 ring-1 ring-slate-100"
							role="dialog"
							aria-modal="true"
							aria-labelledby="google-attach-title"
						>
							<button
								type="button"
								onClick={() => setGoogleAttachOpen(false)}
								className="absolute right-3 top-3 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
								aria-label="Close"
							>
								<X size={18} />
							</button>
							<h2 id="google-attach-title" className="sr-only">
								Connect Google Workspace
							</h2>
							<SessionIntegrationSources
								disabled={isRunning}
								embeddedHeader
								fetchDriveOnOpen
								onImportBatches={appendImportBatches}
								onError={(msg) => setError(msg)}
								onClose={() => setGoogleAttachOpen(false)}
							/>
						</div>
					) : null}

					<p className="mt-6 w-[min(560px,calc(100vw-32px))] text-center text-[11px] leading-5 text-slate-500">
						Supported: PDFs, Office docs, Markdown, text, JSON,
						YAML, CSV, and source files.
					</p>

					{error ? (
						<div className="mt-4 w-[min(560px,calc(100vw-32px))]">
							<ErrorBanner message={error} />
						</div>
					) : null}
        </section>
      ) : (
        <>
          <div className="pointer-events-none absolute inset-0 canvas-dots opacity-[0.18]" />
          <section className={cn(
              "relative mx-auto flex max-w-screen-2xl flex-col gap-3",
              isDone ? "h-[calc(100vh-112px)]" : "h-[calc(100vh-24px)]",
            )}>
            <ThinkingHeader
              stageLabel={stageLabel}
              stage={stage}
              completed={completedStages}
              isRunning={isRunning}
              isDone={isDone}
              thinking={thinking}
              endRef={thinkingEndRef}
              githubRestPipeline={githubRestPipeline}
              restProgress={restProgress}
            />

            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_1fr_320px]">
              {/* Left: file tree styled like the main brain map */}
              <section className="glass min-h-0 overflow-hidden">
                <BuildFileTreeView
                  tree={tree}
                  files={createdFiles}
                />
              </section>

              {/* Center: construction graph */}
              <section className="glass flex min-h-0 flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
                      Construction graph
                    </p>
                    <p className="text-[11px] text-black/70">
                      {createdFiles.length > 0
                        ? `${createdFiles.length} node${createdFiles.length === 1 ? "" : "s"} forming`
                        : "Waiting for first files"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold",
                        isDone
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70"
                          : "bg-black/[0.06] text-black/70",
                      )}
                    >
                      {isDone ? (
                        <CheckCircle2 size={11} />
                      ) : (
                        <Loader2 size={11} className="animate-spin" />
                      )}
                      {isDone ? "Ready" : "Building"}
                    </span>
                    {isDone && (
                      <Link
                        href="/brain"
                        className="inline-flex items-center gap-1.5 rounded-full bg-black px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-black/85"
                      >
                        <Brain size={11} />
                        Open brain map
                      </Link>
                    )}
                  </div>
                </div>
                <div className="relative min-h-0 flex-1">
                  <BootstrapLiveGraph
                    files={createdFiles}
                    isRunning={isRunning}
                  />
                </div>
              </section>

              {/* Right: stages + metrics */}
              <section className="glass flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-black/10 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
                    Pipeline
                  </p>
                  <p className="text-[11px] text-black/70">
                    {completedStages}/{STAGES.length} stages complete
                  </p>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
                  <VerticalBootstrapTimeline
                    current={stage}
                    completed={completedStages}
                  />
                  {githubRestPipeline && (
                    <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-black/70">
                          <GitBranch size={11} />
                          GitHub → brain
                        </span>
                        <span className="font-mono text-[10px] font-bold tabular-nums text-black/65">
                          {Math.min(100, Math.round(restProgress))}%
                        </span>
                      </div>
                      <div className="relative h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
                        <div
                          className="h-full rounded-full bg-[color:var(--accent-600)] transition-[width] duration-700 ease-out"
                          style={{
                            width: `${Math.min(100, restProgress)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <Metric
                      label="Sources"
                      value={sourceCount.toString()}
                    />
                    <Metric
                      label="Chars"
                      value={formatCompact(totalChars)}
                    />
                    <Metric
                      label="Files"
                      value={createdFiles.length.toString()}
                    />
                  </div>
                </div>
              </section>
            </div>

            {error ? <ErrorBanner message={error} /> : null}
          </section>
        </>
      )}

      {isDone && (
        <CompletionBar resultText={resultText} onReset={resetRun} />
      )}
    </main>
  );
}

function UniversalStartEntry({
  text,
  standaloneDocs,
  contextPills,
  githubRepos,
  hasBootstrapSource,
  isDragging,
  isRunning,
  canSubmit,
  onTextChange,
  onPasteGithubRepos,
  onBrowse,
  onRemoveDoc,
  onRemoveContextPill,
  onOpenGoogleWorkspace,
  onRemoveRepo,
  onDragOver,
  onDragLeave,
  onDrop,
  onSubmit,
}: {
  text: string;
  standaloneDocs: UploadDoc[];
  contextPills: ContextBundlePill[];
  githubRepos: GithubRepoFormRow[];
  /** Same as parent session state: any docs or GitHub repos to bootstrap (don’t gate submit on a fragile local count). */
  hasBootstrapSource: boolean;
  isDragging: boolean;
  isRunning: boolean;
  canSubmit: boolean;
  onTextChange: (text: string) => void;
  onPasteGithubRepos: (urls: string[]) => void;
  onBrowse: () => void;
  onRemoveDoc: (id: string) => void;
  onRemoveContextPill: (pillId: string) => void;
  onOpenGoogleWorkspace: () => void;
  onRemoveRepo: (id: string) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onSubmit: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const attachWrapRef = useRef<HTMLDivElement | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  // canSubmit is hasBootstrapSource only; agent reachability is checked when you run (preflight / WS).
  const canRun = canSubmit && !isRunning;

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 20;
    const next = Math.min(160, Math.max(lineHeight, ta.scrollHeight));
    ta.style.height = `${next}px`;
  }, [text]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const el = attachWrapRef.current;
      if (el && !el.contains(e.target as Node)) setAttachMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [attachMenuOpen]);

  const hasAttachments =
    githubRepos.length > 0 || standaloneDocs.length > 0 || contextPills.length > 0;

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="mx-auto w-[min(560px,calc(100vw-32px))]"
    >
      {hasAttachments ? (
        <div className="mb-2.5 flex min-h-[2.75rem] min-w-0 flex-wrap items-center gap-2 px-0.5">
          {githubRepos.map((repo) => {
            const slug = parseRepoSlugFromUrl(repo.url) || repo.url;
            return (
              <AttachmentPill
                key={repo.id}
                icon={<GitBranch className="h-4 w-4" />}
                label={slug}
                disabled={isRunning}
                onRemove={() => onRemoveRepo(repo.id)}
              />
            );
          })}
          {contextPills.map((pill) => (
            <AttachmentPill
              key={pill.id}
              icon={contextPillIcon(pill.kind)}
              label={pill.label}
              disabled={isRunning}
              onRemove={() => onRemoveContextPill(pill.id)}
            />
          ))}
          {standaloneDocs.map((doc) => (
            <AttachmentPill
              key={doc.id}
              icon={<FileText className="h-4 w-4" />}
              label={doc.name}
              disabled={isRunning}
              onRemove={() => onRemoveDoc(doc.id)}
            />
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex min-h-9 items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-1.5 shadow-[0_6px_18px_-12px_rgba(0,0,0,0.18)] transition",
          isDragging && "border-violet-400 bg-violet-50/80",
        )}
      >
        {/* z-10 so this control stays above the textarea when long unbroken text widens the flex row */}
        <div className="relative z-10 flex-shrink-0" ref={attachWrapRef}>
          <button
            type="button"
            onClick={() => setAttachMenuOpen((v) => !v)}
            disabled={isRunning}
            title="Add to context"
            className={cn(
              "relative z-10 flex h-7 w-7 items-center justify-center rounded-lg text-black/45 transition hover:bg-black/[0.06] hover:text-black/75 disabled:opacity-50",
              attachMenuOpen && "bg-black/[0.06] text-black/70",
            )}
          >
            <Paperclip size={14} />
          </button>
          {attachMenuOpen ? (
            <div
              className="absolute bottom-full left-0 z-50 mb-2 w-[min(260px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-black/10 bg-white py-1 shadow-xl shadow-black/10 ring-1 ring-black/5"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] text-black/85 transition hover:bg-black/[0.04]"
                onClick={() => {
                  setAttachMenuOpen(false);
                  onBrowse();
                }}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                  <FileText size={16} />
                </span>
                <span>
                  <span className="block font-semibold">Upload files</span>
                  <span className="block text-[11px] font-normal text-black/45">From your computer</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] text-black/85 transition hover:bg-black/[0.04]"
                onClick={() => {
                  setAttachMenuOpen(false);
                  onOpenGoogleWorkspace();
                }}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/google-workspace.svg" alt="" className="h-5 w-5" draggable={false} />
                </span>
                <span>
                  <span className="block font-semibold">Google Workspace</span>
                  <span className="block text-[11px] font-normal text-black/45">
                    Company folder, calendar, extra Drive files
                  </span>
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <textarea
          ref={taRef}
          value={text}
          disabled={isRunning}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            const urls = extractGithubRepoUrls(pasted);
            if (!urls.length) return;
            e.preventDefault();
            onPasteGithubRepos(urls);
            const remainder = removeGithubRepoUrls(pasted).trim();
            onTextChange(remainder);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
            e.preventDefault();
            if (canRun) onSubmit();
          }}
          placeholder="Paste a GitHub URL, or use the clip to add files & Google…"
          rows={1}
          className={cn(
            // min-w-0: without it, flex-1 textarea won’t shrink and can overlap the paperclip (stealing clicks).
            "m-0 block h-5 max-h-40 min-w-0 flex-1 resize-none self-center overflow-hidden border-none bg-transparent p-0 align-middle outline-none break-words",
            "text-[13px] leading-5 text-black placeholder:text-black/35 disabled:opacity-60",
          )}
        />

        <span className="hidden max-w-[5.5rem] flex-shrink-0 select-none text-right text-[10px] font-medium leading-tight text-black/40 sm:inline">
          Enter or ⌘↵
        </span>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canRun}
          title="Create brain (Enter or ⌘/Ctrl+Enter)"
          className={cn(
            "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border transition",
            hasBootstrapSource || text.trim().length > 0
              ? "border-transparent bg-[color:var(--accent-600)] text-white hover:bg-[color:var(--accent-700)] disabled:opacity-60"
              : "border-black/10 bg-white text-black/35",
          )}
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}

function AttachmentPill({
  icon,
  label,
  disabled,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-[min(240px,42vw)] items-center gap-2 rounded-xl border border-black/8 bg-white py-1 pl-1 pr-1 shadow-sm ring-1 ring-black/[0.04]">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-sky-50 text-violet-800">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight text-black/80">{label}</span>
      {!disabled ? (
        <button
          type="button"
          onClick={onRemove}
          className="flex-shrink-0 rounded-lg p-1.5 text-black/35 transition hover:bg-black/[0.06] hover:text-black/70"
          aria-label={`Remove ${label}`}
        >
          <X size={12} />
        </button>
      ) : null}
    </span>
  );
}

function ThinkingHeader({
  stageLabel,
  stage,
  completed,
  isRunning,
  isDone,
  thinking,
  endRef,
  githubRestPipeline,
  restProgress,
}: {
  stageLabel: string;
  stage: StageId;
  completed: number;
  isRunning: boolean;
  isDone: boolean;
  thinking: string[];
  endRef: React.RefObject<HTMLDivElement | null>;
  githubRestPipeline: boolean;
  restProgress: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const totalStages = STAGES.length;
  const progressPct = githubRestPipeline
    ? Math.min(100, restProgress)
    : isDone
      ? 100
      : Math.round(((completed + (isRunning ? 0.5 : 0)) / totalStages) * 100);
  const latest = thinking[thinking.length - 1] ?? "";
  const summary = isDone
    ? "Done thinking"
    : isRunning
      ? `Thinking · ${stageLabel}${stageIndex >= 0 ? ` (${stageIndex + 1}/${totalStages})` : ""}`
      : stageLabel;

  return (
    <div className="glass overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-black/[0.02]"
      >
        <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black/[0.06]">
          {isDone ? (
            <CheckCircle2 size={14} className="text-emerald-600" />
          ) : (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-[color:var(--accent-400)]/30" />
              <Brain size={14} className="relative text-[color:var(--accent-700)]" />
            </>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-black/90">
              {summary}
            </p>
            {!isDone && isRunning ? (
              <ShimmerDots />
            ) : null}
          </div>
          {!expanded && latest ? (
            <p className="mt-0.5 truncate text-[11px] text-black/55">
              {latest}
            </p>
          ) : null}
        </div>

        <span className="hidden items-center gap-2 sm:flex">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 ease-out",
                isDone
                  ? "bg-emerald-500"
                  : "bg-[color:var(--accent-600)]",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-black/55">
            {progressPct}%
          </span>
        </span>

        <span className="ml-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-black/55 transition hover:bg-black/[0.05] hover:text-black/80">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-black/10">
          <div className="max-h-56 space-y-1 overflow-y-auto px-4 py-3">
            {thinking.map((line, index) => {
              const isLast = index === thinking.length - 1;
              return (
                <div
                  key={`${index}-${line.slice(0, 24)}`}
                  className="flex gap-2 text-[12px] leading-5 text-black/70"
                >
                  <span
                    className={cn(
                      "mt-1.5 flex h-1.5 w-1.5 flex-shrink-0 rounded-full",
                      isLast && isRunning && !isDone
                        ? "bg-[color:var(--accent-500)] ring-2 ring-[color:var(--accent-200)]"
                        : "bg-black/30",
                    )}
                  />
                  <p className="min-w-0 flex-1">{line}</p>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShimmerDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      <span className="h-1 w-1 animate-pulse rounded-full bg-black/40 [animation-delay:0ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-black/40 [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-black/40 [animation-delay:300ms]" />
    </span>
  );
}

function VerticalBootstrapTimeline({
  current,
  completed,
}: {
  current: StageId;
  completed: number;
}) {
  return (
    <ol className="relative space-y-1.5">
      {STAGES.map((step, index) => {
        const active = current === step.id;
        const done = current === "done" || index < completed;
        const isLast = index === STAGES.length - 1;
        return (
          <li key={step.id} className="relative pl-7">
            {!isLast ? (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[11px] top-6 h-[calc(100%-12px)] w-px",
                  done ? "bg-emerald-300/70" : "bg-black/10",
                )}
              />
            ) : null}
            <span
              className={cn(
                "absolute left-0 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold transition",
                done
                  ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300/70"
                  : active
                    ? "bg-[color:var(--accent-100)] text-[color:var(--accent-700)] ring-1 ring-[color:var(--accent-300)]"
                    : "bg-black/[0.06] text-black/55",
              )}
            >
              {done ? <CheckCircle2 size={11} /> : index + 1}
            </span>
            <div
              className={cn(
                "rounded-xl px-2.5 py-1.5 transition",
                active && !done
                  ? "bg-[color:var(--accent-50)] ring-1 ring-[color:var(--accent-200)]"
                  : "",
              )}
            >
              <p
                className={cn(
                  "text-[12px] font-semibold",
                  done
                    ? "text-emerald-700"
                    : active
                      ? "text-[color:var(--accent-800)]"
                      : "text-black/75",
                )}
              >
                {step.label}
                {active && !done ? (
                  <span className="ml-1.5 inline-flex">
                    <ShimmerDots />
                  </span>
                ) : null}
              </p>
              <p className="text-[10px] leading-4 text-black/50">
                {step.desc}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
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
		if (files.length > 0 && startRef.current === 0)
			startRef.current = Date.now();
    for (const f of files) {
      if (!arrivalRef.current.has(f.path)) {
        arrivalRef.current.set(f.path, Date.now());
      }
    }
  }, [files]);

  const visible = files.slice(0, 28);
	const doneCount = visible.filter(
		(f) => f.status === "done" && !f.isGhost,
	).length;
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

	const {
		width: W,
		dirX,
		pillHalfW,
	} = layoutBootstrapDirectoryRow(dirNames, VIEW_MIN);

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

	const posByPath = new Map<string, FNode>(
		fnodes.map((fn) => [fn.file.path, fn]),
	);
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
			crossLinks.push({
				from: fn,
				to: toNode,
				ghostly: Boolean(fn.file.isGhost || toNode.file.isGhost),
			});
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
					{hasBrain
						? `${dirNames.length} dir · ${visible.length} nodes`
						: "Waiting"}
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
							<circle
								cx={W / 2}
								cy={BRAIN_Y}
								r="22"
								fill="#ede9fe"
								stroke="#8b5cf6"
								strokeWidth="2.2"
							/>
							<circle
								cx={W / 2}
								cy={BRAIN_Y}
								r="6"
								fill="#7c3aed"
							/>
							<text
								x={W / 2}
								y={BRAIN_Y + 40}
								textAnchor="middle"
								fontSize="11"
								fontWeight="700"
								fontFamily="ui-sans-serif,system-ui,sans-serif"
								fill="#4c1d95"
							>
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
							const hw =
								pillHalfW.get(d) ??
								Math.max(40, d.length * 5.6 + 24);
              const w = hw * 2;
              const delay = 0.4 + i * DIR_STAGGER;
              return (
								<g
									key={`d-${d}`}
									className="cg-pop"
									style={{ animationDelay: `${delay}s` }}
								>
                  <title>{`${d}/`}</title>
									<rect
										x={dx - hw}
										y={DIR_Y - 16}
										width={w}
										height="32"
										rx="10"
										fill="white"
										stroke="#a5b4fc"
										strokeWidth="1.4"
									/>
									<text
										x={dx}
										y={DIR_Y + 5}
										textAnchor="middle"
										fontSize="10"
										fontWeight="700"
										fontFamily="ui-sans-serif,system-ui,sans-serif"
										fill="#4338ca"
									>
										{d.length > 18
											? `${d.slice(0, 16)}\u2026`
											: d}
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
									stroke={
										ghost
											? "#ddd6fe"
											: done
												? "#86efac"
												: writ
													? "#c4b5fd"
													: "#e2e8f0"
									}
                  strokeWidth={writ ? 1.8 : 1.2}
									strokeDasharray={
										ghost ? "4 4" : done ? "none" : "5 5"
									}
                  opacity={ghost ? 0.65 : 1}
                  className={writ ? "cg-flow" : "cg-draw"}
									style={
										!writ
											? { animationDelay: `${delay}s` }
											: undefined
									}
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
							const midY =
								(y1 + y2) / 2 + (dx / dist) * off * 0.55;
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
							const special =
								file.path === "index.md" ||
								file.path === "map.md";
              const r = special ? 14 : 11;
							const baseName =
								file.path
									.split("/")
									.pop()
									?.replace(/\.mdx?$/i, "") ?? "";
              const name = truncateFileLabel(baseName, 17);
              const d = directoryOf(file.path);
              const dIdx = dirOrder.get(d) ?? 0;
              const baseDelay = 0.7 + dIdx * DIR_STAGGER;
              const delay = baseDelay + o * NODE_STAGGER;
              return (
								<g
									key={file.path}
									className="cg-pop"
									style={{
										animationDelay: `${delay}s`,
										opacity: ghost ? 0.82 : 1,
									}}
								>
                  <title>{file.path}</title>
                  {writ && (
										<circle
											cx={x}
											cy={y}
											r="22"
											fill="none"
											stroke="#8b5cf6"
											strokeWidth="1.5"
											className="cg-ring"
											opacity="0.3"
										/>
                  )}
                  <circle
										cx={x}
										cy={y}
										r={r}
										fill={
											ghost
												? done
													? "#f5f3ff"
													: writ
														? "#faf5ff"
														: "#fafafe"
												: done
													? "#ecfdf5"
													: writ
														? "#f5f3ff"
														: planned
															? "#fafafe"
															: "#f8fafc"
										}
										stroke={
											special
												? "#fbbf24"
												: ghost
													? "#a78bfa"
													: done
														? "#34d399"
														: writ
															? "#a78bfa"
															: "#cbd5e1"
										}
                    strokeWidth={writ ? 2.2 : 1.5}
										strokeDasharray={
											ghost ? "3 3" : undefined
										}
                  />
                  <circle
										cx={x}
										cy={y}
										r="3"
										fill={
											special
												? "#f59e0b"
												: ghost
													? "#8b5cf6"
													: done
														? "#10b981"
														: writ
															? "#8b5cf6"
															: "#94a3b8"
										}
                  />
                  <text
										x={x}
										y={y + r + 15}
										textAnchor="middle"
										fontSize="8"
										fontWeight="600"
                    fontFamily="ui-monospace,SFMono-Regular,monospace"
                    className="cg-fade"
										style={{
											animationDelay: `${delay + 0.15}s`,
										}}
										fill={
											ghost
												? "#7c3aed"
												: done
													? "#059669"
													: writ
														? "#6d28d9"
														: "#64748b"
										}
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
				{isRunning
					? "Planning brain structure\u2026"
					: "Waiting for files"}
      </text>
    </g>
  );
}

function pathsToVirtualTree(paths: string[]): BrainTreeNode[] {
	const uniq = [...new Set(paths)]
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
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
				node = {
					name: seg,
					path: acc,
					type: isLeaf ? "file" : "directory",
					children: isLeaf ? undefined : [],
				};
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

function BuildFileTreeView({
  tree,
  files,
}: {
  tree: BrainTreeNode[];
  files: CreatedFile[];
}) {
  const virtualTree = useMemo(
    () => pathsToVirtualTree(files.map((f) => f.path)),
    [files],
  );
  const displayTree = tree.length > 0 ? tree : virtualTree;
  const fileByPath = useMemo(
    () => new Map(files.map((f) => [f.path, f])),
    [files],
  );
  const fileCount = files.filter(
    (f) => f.path && !f.path.endsWith("/"),
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
            Files
          </p>
          <p className="text-[11px] text-black/70">
            {fileCount === 0
              ? "Waiting for first files"
              : `${fileCount} node${fileCount === 1 ? "" : "s"} forming`}
          </p>
        </div>
        <span className="rounded-full bg-black/[0.06] px-2.5 py-1 font-mono text-[10px] text-black/70">
          brain/
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {displayTree.length ? (
          displayTree.map((node) => (
            <BuildTreeNode
              key={node.path}
              node={node}
              depth={0}
              fileByPath={fileByPath}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-black/40">
            <Folder size={20} className="mb-2 opacity-50" />
            <p className="text-[11px] font-medium">
              Files appear here as the agent writes them
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BuildTreeNode({
  node,
  depth,
  fileByPath,
}: {
  node: BrainTreeNode;
  depth: number;
  fileByPath: Map<string, CreatedFile>;
}) {
  const [open, setOpen] = useState(true);
  const hint = node.type === "file" ? fileByPath.get(node.path) : undefined;
  const ghost = hint?.isGhost === true;
  const writing = hint?.status === "writing";
  const done = hint?.status === "done";

  if (node.type === "directory") {
    const childCount = node.children?.length ?? 0;
    return (
      <div className="mb-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left transition hover:bg-black/[0.05]"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-black/55">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <Folder size={13} className="flex-shrink-0 text-black/65" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-black/80">
            {node.name}
          </span>
          <span className="flex-shrink-0 rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-black/60">
            {childCount}
          </span>
        </button>
        {open ? (
          <div className="space-y-0.5">
            {node.children?.map((child) => (
              <BuildTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                fileByPath={fileByPath}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl px-2 py-1.5 transition",
        writing
          ? "bg-[color:var(--accent-50)] ring-1 ring-[color:var(--accent-200)]"
          : "hover:bg-black/[0.04]",
        ghost && "opacity-80",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <FileText
        size={13}
        className={cn(
          "mt-0.5 flex-shrink-0",
          done
            ? "text-emerald-600"
            : writing
              ? "text-[color:var(--accent-700)]"
              : ghost
                ? "text-[color:var(--accent-500)]"
                : "text-black/65",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[11px] leading-tight text-black/80">
          {node.name}
        </span>
      </span>
      {writing ? (
        <Loader2
          size={11}
          className="ml-1 mt-0.5 flex-shrink-0 animate-spin text-[color:var(--accent-600)]"
        />
      ) : ghost ? (
        <span className="ml-1 mt-0.5 rounded bg-[color:var(--accent-100)] px-1 text-[8px] font-bold uppercase tracking-wider text-[color:var(--accent-700)]">
          preview
        </span>
      ) : done ? (
        <span className="ml-1 mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
      ) : (
        <span className="ml-1 mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-black/25" />
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-red-700 shadow-sm backdrop-blur-xl">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">Session failed</p>
        <p className="mt-0.5 whitespace-pre-line text-[11px] leading-4">
          {message}
        </p>
      </div>
    </div>
  );
}

function CompletionBar({
	resultText,
	onReset,
}: {
	resultText: string;
	onReset: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-emerald-200/70 bg-white/85 px-6 py-4 shadow-2xl shadow-emerald-900/10 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 ring-1 ring-emerald-200/70">
          <CheckCircle2 size={22} className="text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-slate-800">
						Brain is ready
					</p>
          <p className="truncate text-xs text-slate-500">
						{resultText ||
							"Stay on this screen as long as you like—open the map only when you choose."}
          </p>
        </div>
				<button
					onClick={onReset}
					className="rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
				>
          New session
        </button>
				<Link
					href="/brain"
					className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-200/70 transition hover:bg-emerald-700"
				>
          <Brain size={13} />
          View brain map
        </Link>
				<Link
					href="/agent"
					className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-violet-200/70 transition hover:bg-violet-700"
				>
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
    <div className="rounded-xl border border-black/10 bg-white/60 px-2 py-2">
      <p className="text-base font-bold tabular-nums leading-tight text-black/85">
        {value}
      </p>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-black/45">
        {label}
      </p>
    </div>
  );
}

function extensionOf(name: string) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function extractGithubRepoUrls(text: string): string[] {
	const matches = text.match(/https?:\/\/github\.com\/[^\s"'<>]+/gi) ?? [];
	return matches
		.map(normalizeGithubRepoUrl)
		.filter((url): url is string => Boolean(url));
}

function removeGithubRepoUrls(text: string): string {
	return text
		.replace(/https?:\/\/github\.com\/[^\s"'<>]+/gi, "")
		.replace(/\s+/g, " ");
}

function normalizeGithubRepoUrl(raw: string): string | null {
	try {
		const url = new URL(raw.trim().replace(/[),.;\]]+$/g, ""));
		if (url.hostname.toLowerCase() !== "github.com") return null;
		const [owner, repo] = url.pathname.split("/").filter(Boolean);
		if (!owner || !repo) return null;
		return `https://github.com/${owner}/${repo.replace(/\.git$/i, "")}`;
	} catch {
		return null;
	}
}

function formatCompact(value: number) {
	return new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
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
): {
	width: number;
	dirX: Map<string, number>;
	pillHalfW: Map<string, number>;
} {
  const sidePad = 44;
  const minBetween = 16;
  const pillPadX = 24;
	const halfWidths = dirNames.map((d) =>
		Math.max(40, d.length * 5.6 + pillPadX),
	);
  const pillHalfW = new Map<string, number>();
  dirNames.forEach((d, i) => pillHalfW.set(d, halfWidths[i]!));

  if (dirNames.length === 0) {
    return { width: viewMin, dirX: new Map(), pillHalfW };
  }
  if (dirNames.length === 1) {
    const d0 = dirNames[0]!;
		return {
			width: viewMin,
			dirX: new Map([[d0, viewMin / 2]]),
			pillHalfW,
		};
  }

  const centers: number[] = [];
  let x = sidePad + halfWidths[0]!;
  centers.push(x);
  for (let i = 1; i < dirNames.length; i++) {
    x = centers[i - 1]! + halfWidths[i - 1]! + minBetween + halfWidths[i]!;
    centers.push(x);
  }
	const rawRight =
		centers[centers.length - 1]! +
		halfWidths[halfWidths.length - 1]! +
		sidePad;
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
		reader.onerror = () =>
			reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function resolveBootstrapWsUrl(serverBootstrapUrl?: string | null) {
  const fromServer = serverBootstrapUrl?.trim();
  if (fromServer) return normalizeBootstrapWsUrlForBrowser(fromServer);
  if (process.env.NEXT_PUBLIC_AGENT_WS_URL) {
    return normalizeBootstrapWsUrlForBrowser(process.env.NEXT_PUBLIC_AGENT_WS_URL);
  }
  const base = env.agentApiUrlPublic;
  if (base) {
    try {
      const u = new URL(base);
      const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
      return normalizeBootstrapWsUrlForBrowser(`${wsProto}//${u.host}/bootstrap/ws`);
    } catch {
      /* use localhost fallback */
    }
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return normalizeBootstrapWsUrlForBrowser(
    `${protocol}://${window.location.hostname}:8000/bootstrap/ws`,
  );
}

function stageTitle(stage: StageId) {
  return STAGES.find((item) => item.id === stage)?.label ?? stage;
}

function formatInitializeErrorDetail(
	raw: { detail?: unknown },
	status: number,
): string {
  const d = raw.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
			.map((item) =>
				typeof item === "object" && item && "msg" in item
					? String((item as { msg: unknown }).msg)
					: JSON.stringify(item),
			)
      .join("; ");
  }
  if (d != null && typeof d === "object") return JSON.stringify(d);
  return `Initialize failed (${status})`;
}
