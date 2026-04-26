"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Hash,
  LayoutDashboard,
  Network,
  PlugZap,
  TrendingUp,
} from "lucide-react";

import { uniqueBrainFileLabels } from "@/lib/brain/brain-file-label";
import type { BrianFile } from "@/lib/brian/reader";
import { cn } from "@/lib/utils";

const importanceRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

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
    for (const seg of dirParts) node = ensureChild(node, seg);
    node.files.push(file);
  }

  function sortTree(node: FileTreeNode) {
    node.children.sort((a, b) => a.segment.localeCompare(b.segment, undefined, { sensitivity: "base" }));
    node.files.sort(compareFilesForNav);
    node.children.forEach(sortTree);
  }
  sortTree(root);

  return root;
}

function humanizePathSegment(segment: string): string {
  const spaced = segment.replace(/_/g, " ").replace(/-/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
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
  agent_prompt: Network,
  summary: BookOpen,
  context: FileText,
  goals: TrendingUp,
  map: Network,
};

function FileRowIcon({ type }: { type?: string }) {
  const Icon = FILE_TYPE_ICON[type ?? ""] ?? FileText;
  return <Icon size={14} className="flex-shrink-0 text-black/70" />;
}

function SidebarFileButton({
  file,
  active,
  onSelect,
  tint,
  displayLabel,
}: {
  file: BrianFile;
  active: boolean;
  onSelect: () => void;
  tint: string;
  displayLabel: string;
}) {
  const primary = displayLabel;
  const ctx = fileContextPath(file);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition",
        active ? "bg-black/[0.07]" : "hover:bg-black/[0.05]",
      )}
    >
      <FileRowIcon type={file.frontmatter.type} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[11px] leading-tight", active ? "text-black" : "text-black/85")}>
          {primary}
        </span>
        {ctx ? (
          <span className="mt-0.5 block truncate font-mono text-[9px] leading-tight text-black/55" title={file.path}>
            {ctx}
          </span>
        ) : null}
      </span>
      <span
        className="ml-2 mt-1 h-2 w-2 flex-shrink-0 rounded-full ring-1 ring-black/10"
        style={{ background: tint }}
        aria-hidden
      />
    </button>
  );
}

function ElbowRow({
  isLast,
  children,
}: {
  isLast: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-2">
      {/* Vertical segment of the elbow (extends only halfway if last) */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 top-0 w-px bg-black/15",
          isLast ? "h-[18px]" : "bottom-0",
        )}
      />
      {/* Horizontal stub of the elbow */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-[18px] h-px w-1.5 bg-black/15"
      />
      {children}
    </div>
  );
}

function countFilesInSubtree(node: FileTreeNode): number {
  let n = node.files.length;
  for (const c of node.children) n += countFilesInSubtree(c);
  return n;
}

function FolderHeader({
  segment,
  total,
  expanded,
  onToggle,
}: {
  segment: string;
  total: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left transition",
        "hover:bg-black/[0.05] text-black/85",
      )}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-black/55">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <Folder size={13} className="flex-shrink-0 text-black/65" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-black/80">
        {segment}
      </span>
      <span className="flex-shrink-0 rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-black/60">
        {total}
      </span>
    </button>
  );
}

function FolderSubtree({
  node,
  selectedPath,
  navExpanded,
  onToggleFolder,
  onSelectFile,
  getTint,
  labelByPath,
}: {
  node: FileTreeNode;
  selectedPath?: string;
  navExpanded: Record<string, boolean>;
  onToggleFolder: (pathKey: string) => void;
  onSelectFile: (file: BrianFile) => void;
  getTint: (path: string) => string;
  labelByPath: Map<string, string>;
}) {
  const expanded = navExpanded[node.pathKey] !== false;
  const total = countFilesInSubtree(node);
  const totalChildren = node.files.length + node.children.length;

  return (
    <div className="mb-0.5">
      <FolderHeader
        segment={node.segment}
        total={total}
        expanded={expanded}
        onToggle={() => onToggleFolder(node.pathKey)}
      />

      {expanded && totalChildren > 0 && (
        <div className="relative ml-[14px] mt-0.5 space-y-0.5">
          {node.files.map((file, i) => {
            const isLast =
              i === node.files.length - 1 && node.children.length === 0;
            return (
              <ElbowRow key={file.path} isLast={isLast}>
                <SidebarFileButton
                  file={file}
                  active={selectedPath === file.path}
                  onSelect={() => onSelectFile(file)}
                  tint={getTint(file.path)}
                  displayLabel={labelByPath.get(file.path) ?? file.path}
                />
              </ElbowRow>
            );
          })}
          {node.children.map((grand, i) => {
            const isLast = i === node.children.length - 1;
            return (
              <ElbowRow key={grand.pathKey} isLast={isLast}>
                <FolderSubtree
                  node={grand}
                  selectedPath={selectedPath}
                  navExpanded={navExpanded}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                  getTint={getTint}
                  labelByPath={labelByPath}
                />
              </ElbowRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tree({
  node,
  selectedPath,
  navExpanded,
  onToggleFolder,
  onSelectFile,
  getTint,
  labelByPath,
}: {
  node: FileTreeNode;
  selectedPath?: string;
  navExpanded: Record<string, boolean>;
  onToggleFolder: (pathKey: string) => void;
  onSelectFile: (file: BrianFile) => void;
  getTint: (path: string) => string;
  labelByPath: Map<string, string>;
}) {
  return (
    <div className="pl-1">
      {node.files.length > 0 && (
        <div className="mb-2">
          <p className="px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-black/55">
            Top level
          </p>
          {node.files.map((file) => (
            <SidebarFileButton
              key={file.path}
              file={file}
              active={selectedPath === file.path}
              onSelect={() => onSelectFile(file)}
              tint={getTint(file.path)}
              displayLabel={labelByPath.get(file.path) ?? file.path}
            />
          ))}
        </div>
      )}

      {node.children.map((child) => (
        <FolderSubtree
          key={child.pathKey}
          node={child}
          selectedPath={selectedPath}
          navExpanded={navExpanded}
          onToggleFolder={onToggleFolder}
          onSelectFile={onSelectFile}
          getTint={getTint}
          labelByPath={labelByPath}
        />
      ))}
    </div>
  );
}

export function FileTree({
  files,
  selectedPath,
  onSelect,
  getTint,
}: {
  files: BrianFile[];
  selectedPath?: string;
  onSelect: (file: BrianFile) => void;
  getTint: (path: string) => string;
}) {
  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const labelByPath = useMemo(() => uniqueBrainFileLabels(files), [files]);
  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
            Files
          </p>
          <p className="text-[11px] text-black/70">
            {files.length} nodes available
          </p>
        </div>
        <span className="rounded-full bg-black/[0.06] px-2.5 py-1 font-mono text-[10px] text-black/70">
          brian/
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Tree
          node={fileTree}
          selectedPath={selectedPath}
          navExpanded={navExpanded}
          onToggleFolder={(key) =>
            setNavExpanded((prev) => ({ ...prev, [key]: !(prev[key] !== false) }))
          }
          onSelectFile={onSelect}
          getTint={getTint}
          labelByPath={labelByPath}
        />
      </div>
    </div>
  );
}

