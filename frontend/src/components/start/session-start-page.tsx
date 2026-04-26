"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Calendar,
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
  fileLabelForConstruction,
  parseFrontmatterTitle,
} from "@/lib/brain/construction-file-label";
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
  { id: "write", label: "Write", desc: "Create Brian files" },
  { id: "index", label: "Index", desc: "Warm retrieval" },
  { id: "verify", label: "Verify", desc: "Confirm readiness" },
];

const INITIAL_NODES: GraphNode[] = [
  { id: "documents", label: "Codebase & sources", status: "idle" },
  { id: "normalize", label: "Normalize", status: "idle" },
  { id: "distill", label: "Distill", status: "idle" },
  { id: "brain_files", label: "Brian files", status: "idle" },
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
	const [githubRepos, setGithubRepos] = useState<GithubRepoFormRow[]>(() => [
		newGithubRepoRow(),
	]);
	const [entryText, setEntryText] = useState("");
  const prompt =
    "Build Brian for your company from the linked GitHub repositories, uploads, and Google Workspace imports. Put each supported department or function in its own directory (company/engineering, company/finance, …), link sections to each other in the Markdown, and use map.md to visualize how the company fits together. Multiple AI agents should share one grounded org picture—decisions, metrics, owners, risks, guardrails—only what the sources support.";
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
  const [, setTree] = useState<BrainTreeNode[]>([]);
  const [createdFiles, setCreatedFiles] = useState<CreatedFile[]>([]);
  const [, setThinking] = useState<string[]>([]);
  const [, setResultText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  /** From GET /api/agent/stream — matches server-side AGENT_API_URL on localhost when NEXT_PUBLIC_* is unset. */
  const bootstrapWsUrlRef = useRef<string | undefined>(undefined);
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

      const nextFiles: CreatedFile[] = body.files.map((file) => {
        const fm = file.frontmatter as { title?: unknown };
        const t =
          typeof fm?.title === "string" && fm.title.trim()
            ? fm.title.trim()
            : parseFrontmatterTitle(file.content) ?? null;
        const title = fileLabelForConstruction(file.path, {
          title: t,
          content: file.content,
        });
        return {
          path: file.path,
          title,
          preview:
            typeof file.content === "string" && file.content.trim().length > 0
              ? file.content.trim().slice(0, 180)
              : undefined,
          status: "done" as const,
          isGhost: false,
        };
      });

      setCreatedFiles(nextFiles);
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
  const buildMode = isRunning || isDone || createdFiles.length > 0;
  const completedStages = useMemo(() => {
    if (isDone) return STAGES.length;
    const idx = STAGES.findIndex((item) => item.id === stage);
    return Math.max(0, idx);
  }, [isDone, stage]);

  const progressPct = useMemo(() => {
    if (githubRestPipeline) return Math.min(100, restProgress);
    if (isDone) return 100;
    return Math.round(((completedStages + (isRunning ? 0.5 : 0)) / STAGES.length) * 100);
  }, [githubRestPipeline, restProgress, isDone, completedStages, isRunning]);

  useEffect(() => {
    if (isDone) {
      router.push("/brain");
    }
  }, [isDone, router]);

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
      setStageLabel("Brian ready");
      setIsDone(true);
      setIsRunning(false);
      setResultText(event.result_text);
      setThinking((prev) => [
        ...prev,
        `Done. I wrote ${event.written_files.length} Brian file${event.written_files.length === 1 ? "" : "s"} and warmed retrieval for the demo.`,
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
      setStageLabel("Hand-off to Brian backend…");
      setThinking([
        "Starting the GitHub → Brian pipeline. Your repo is being shallow-cloned and scanned server-side—this story plays out in real time below.",
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
          label: "Authoring Brian markdown…",
          line: "The model is shaping projects/, architecture, and cross-links you can browse.",
        },
        {
          t: 12800,
          stage: "index",
          label: "Wiring retrieval…",
          line: "Sections are prepared so search and agents can use Brian immediately.",
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
          "Laying out the Brian directory scaffold—watch files and cross-links appear while the server still works.",
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
          setStageLabel("Materializing Brian files on the canvas…");
          setThinking((prev) => [
            ...prev,
            `Response received. Animating ${written.length} file${written.length === 1 ? "" : "s"} into the construction graph.`,
          ]);

          const detailByPath = new Map<string, { title: string; content: string }>();
          try {
            const pres = await fetch("/api/agent/files", { cache: "no-store" });
            if (pres.ok) {
              const data = (await pres.json()) as {
                files?: Array<{
                  path: string;
                  content: string;
                  frontmatter: Record<string, unknown>;
                }>;
              };
              for (const f of data.files ?? []) {
                const raw =
                  typeof f.frontmatter?.title === "string" && f.frontmatter.title.trim()
                    ? f.frontmatter.title.trim()
                    : null;
                const title = fileLabelForConstruction(f.path, {
                  title: raw,
                  content: f.content,
                });
                detailByPath.set(f.path, { title, content: f.content });
              }
            }
          } catch {
            // Fall back to path-based labels for each file.
          }

          let delay = 320;
          const step = 155;
          for (const path of written) {
            const rel = path;
            const d = detailByPath.get(rel);
            const fileTitle = d?.title ?? fileLabelForConstruction(rel, { content: d?.content });
            scheduleRest(delay, () => {
              setCreatedFiles((prev) =>
                upsertFile(prev, {
                  path: rel,
                  title: fileTitle,
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
                "No new file paths were reported—check the agent logs or open the Brian workspace anyway.",
              ]);
            });
          }

          scheduleRest(delay + 400, () => {
            setRestProgress(100);
            setStage("done");
            setStageLabel("Brian ready");
            setResultText(String(raw.result_text ?? ""));
            setThinking((prev) => [
              ...prev,
              `Done. ${written.length} Brian file${written.length === 1 ? "" : "s"} staged. Opening the full workspace is one click away.`,
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
            "The Brian backend is not running or Next.js cannot reach it. In a second terminal run: npm run brain-api (from the frontend folder) or: cd agent && uv run brain-api — then reload this page. Set AGENT_API_URL / NEXT_PUBLIC_AGENT_API_URL in .env if the API is not on port 8000.",
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
          "Could not verify the Brian backend (request to /api/agent/stream failed). Check that the Next dev server is running, then start brain-api (npm run brain-api from frontend/).",
        );
        setIsRunning(false);
        setStage("upload");
        setStageLabel("Add a GitHub repo or uploads");
        return;
      }

      setStageLabel("Connecting to the Brian backend");
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
          `Could not open the bootstrap WebSocket (${wsUrl}). Start the Brian backend on port 8000 (npm run brain-api from frontend/, or cd agent && uv run brain-api). If the UI is not on the same machine, set NEXT_PUBLIC_AGENT_API_URL to the URL your browser can reach.`,
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
            <h1 className="text-5xl font-bold tracking-tight text-slate-950 md:text-6xl">
              What should Brian learn first?
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-500">
              Add a GitHub repo, files, or Google Workspace. Context appears as chips above the box.
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
        <section className="relative mx-auto flex h-[calc(100vh-48px)] max-w-xl flex-col items-center justify-center gap-4">
          <p className="text-center text-sm font-medium text-slate-700">
            {isDone ? "Brian is ready. Opening map…" : stageLabel}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 ease-out",
                isDone ? "bg-emerald-500" : "bg-[color:var(--accent-600)]",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="font-mono text-[10px] tabular-nums text-slate-400">
            {progressPct}%
          </p>
          {error ? (
            <div className="w-full">
              <ErrorBanner message={error} />
            </div>
          ) : null}
        </section>
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
          placeholder="Repo URL, files, or Google…"
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
          title="Create Brian (Enter or ⌘/Ctrl+Enter)"
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
