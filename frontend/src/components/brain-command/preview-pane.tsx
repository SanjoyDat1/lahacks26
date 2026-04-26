"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";

import type { BrianFile } from "@/lib/brian/reader";
import {
  buildBrianPathLookup,
  isExternalOrNonBrainHref,
  resolveBrainLinkHref,
} from "@/lib/brian/resolve-markdown-link";
import { cn } from "@/lib/utils";
import { mdComponents, useExpandedModal } from "./markdown-components";

type ConnectedPage = {
  file: BrianFile;
  direction: "out" | "in";
};

function fileTitle(f: BrianFile): string {
  return (
    f.frontmatter.title ??
    f.path
      .split("/")
      .pop()
      ?.replace(/\.md$/, "")
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ??
    f.path
  );
}

function buildLookup(files: BrianFile[]) {
  const map = new Map<string, BrianFile>();
  for (const f of files) {
    const id = f.frontmatter.id ?? f.path;
    const noExt = f.path.replace(/\.md$/, "");
    map.set(id, f);
    map.set(f.path, f);
    map.set(noExt, f);
    map.set(noExt.replace(/\//g, "."), f);
  }
  return map;
}

function getConnectedPages(file: BrianFile, allFiles: BrianFile[]): ConnectedPage[] {
  const lookup = buildLookup(allFiles);
  const selfId = file.frontmatter.id ?? file.path;
  const selfKeys = new Set([
    selfId,
    file.path,
    file.path.replace(/\.md$/, ""),
    file.path.replace(/\.md$/, "").replace(/\//g, "."),
  ]);

  const seen = new Set<string>();
  const out: ConnectedPage[] = [];

  for (const link of file.frontmatter.links ?? []) {
    const target = lookup.get(link) ?? lookup.get(link.replace(/\.md$/, ""));
    if (!target || target.path === file.path) continue;
    if (seen.has(target.path)) continue;
    seen.add(target.path);
    out.push({ file: target, direction: "out" });
  }

  for (const candidate of allFiles) {
    if (candidate.path === file.path) continue;
    if (seen.has(candidate.path)) continue;
    const links = candidate.frontmatter.links ?? [];
    const linksHere = links.some((l) => {
      if (selfKeys.has(l)) return true;
      const stripped = l.replace(/\.md$/, "");
      return selfKeys.has(stripped);
    });
    if (linksHere) {
      seen.add(candidate.path);
      out.push({ file: candidate, direction: "in" });
    }
  }

  return out;
}

function splitFirstH1(content: string): { title: string | null; body: string } {
  const match = content.match(/^[ \t]*#\s+(.+?)\s*$/m);
  if (!match || match.index === undefined) return { title: null, body: content };
  const before = content.slice(0, match.index);
  if (before.trim().length > 0) return { title: null, body: content };
  const after = content.slice(match.index + match[0].length);
  return { title: match[1]!.trim(), body: after.replace(/^\s*\n/, "") };
}

function ConnectedPagesList({
  pages,
  accentForPath,
  onSelect,
}: {
  pages: ConnectedPage[];
  accentForPath: (path: string) => string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [lineHeight, setLineHeight] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const chips = Array.from(el.children) as HTMLElement[];
      if (chips.length === 0) {
        setOverflows(false);
        setLineHeight(null);
        return;
      }
      const first = chips[0]!;
      const firstTop = first.offsetTop;
      let multiLine = false;
      for (let i = 1; i < chips.length; i++) {
        if (chips[i]!.offsetTop > firstTop + 1) {
          multiLine = true;
          break;
        }
      }
      setOverflows(multiLine);
      setLineHeight(first.offsetHeight);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages]);

  useEffect(() => {
    if (!overflows && expanded) setExpanded(false);
  }, [overflows, expanded]);

  if (pages.length === 0) return null;

  const collapsed = overflows && !expanded;
  const maxHeight = collapsed && lineHeight ? lineHeight : undefined;

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
          Connected pages
        </p>
        {overflows ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-black/65 transition hover:bg-white hover:text-black"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <ChevronUp size={10} />
                Show less
              </>
            ) : (
              <>
                <ChevronDown size={10} />
                Show all ({pages.length})
              </>
            )}
          </button>
        ) : null}
      </div>
      <div
        ref={containerRef}
        className={cn(
          "flex flex-wrap gap-1.5 transition-[max-height] duration-200 ease-out",
          collapsed ? "overflow-hidden" : "",
        )}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {pages.map(({ file: linked, direction }) => {
          const label = fileTitle(linked);
          return (
            <button
              key={`${direction}:${linked.path}`}
              type="button"
              onClick={() => onSelect(linked.path)}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-black/75 transition",
                "hover:bg-white hover:text-black",
              )}
              style={{ boxShadow: `inset 0 0 0 1px ${accentForPath(linked.path)}33` }}
              title={`${direction === "out" ? "Links to" : "Linked from"} ${linked.path}`}
            >
              {direction === "out" ? (
                <ArrowUpRight size={10} className="text-black/45 group-hover:text-black/70" />
              ) : (
                <ArrowDownLeft size={10} className="text-black/45 group-hover:text-black/70" />
              )}
              <span className="truncate max-w-[160px]">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const linkLikeClass =
  "text-[color:var(--accent-700)] underline decoration-black/20 underline-offset-2 hover:decoration-[color:var(--accent-700)]";

const markdownComponentsBase: Omit<Components, "a"> = {
  h1: ({ children, ...p }) => (
    <h1 {...p} className="mt-6 mb-4 text-2xl font-semibold tracking-tight text-black first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children, ...p }) => (
    <h2 {...p} className="mt-7 mb-3 text-xl font-semibold tracking-tight text-black first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children, ...p }) => (
    <h3 {...p} className="mt-6 mb-2.5 text-base font-semibold tracking-tight text-black/95 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children, ...p }) => (
    <h4 {...p} className="mt-5 mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-black/80 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children, ...p }) => (
    <p {...p} className="my-3 text-[13px] leading-7 text-black/80">
      {children}
    </p>
  ),
  ul: ({ children, ...p }) => (
    <ul {...p} className="my-3 ml-5 list-disc space-y-1.5 text-[13px] leading-7 text-black/80 marker:text-black/45">
      {children}
    </ul>
  ),
  ol: ({ children, ...p }) => (
    <ol {...p} className="my-3 ml-5 list-decimal space-y-1.5 text-[13px] leading-7 text-black/80 marker:text-black/55">
      {children}
    </ol>
  ),
  li: ({ children, ...p }) => (
    <li {...p} className="pl-1">
      {children}
    </li>
  ),
  strong: ({ children, ...p }) => (
    <strong {...p} className="font-semibold text-black">
      {children}
    </strong>
  ),
  em: ({ children, ...p }) => (
    <em {...p} className="italic text-black/85">
      {children}
    </em>
  ),
  blockquote: ({ children, ...p }) => (
    <blockquote {...p} className="my-4 border-l-2 border-black/20 pl-4 text-[13px] italic text-black/70">
      {children}
    </blockquote>
  ),
  hr: (p) => <hr {...p} className="my-6 border-black/10" />,
  code: ({ className, children, ...p }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code {...p} className={cn(className, "block whitespace-pre text-[12px] leading-6 text-black/85")}>
          {children}
        </code>
      );
    }
    return (
      <code
        {...p}
        className="rounded-md border border-black/10 bg-black/[0.05] px-1.5 py-0.5 font-mono text-[12px] text-black/90"
      >
        {children}
      </code>
    );
  },
  pre: ({ children, ...p }) => (
    <pre
      {...p}
      className="my-4 overflow-x-auto rounded-xl border border-black/10 bg-black/[0.05] p-4 font-mono text-[12px] leading-6 text-black/85"
    >
      {children}
    </pre>
  ),
  table: ({ children, ...p }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-black/10">
      <table {...p} className="w-full border-collapse text-[12px] text-black/80">
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...p }) => (
    <th {...p} className="border-b border-black/10 bg-black/[0.04] px-3 py-2 text-left font-semibold text-black/85">
      {children}
    </th>
  ),
  td: ({ children, ...p }) => (
    <td {...p} className="border-b border-black/[0.06] px-3 py-2 align-top">
      {children}
    </td>
  ),
};

export function PreviewPane({
  file,
  onSelectSource,
  accentForPath,
  allFiles = [],
}: {
  file: BrianFile | null;
  onSelectSource: (titleOrPath: string) => void;
  accentForPath: (path: string) => string;
  allFiles?: BrianFile[];
}) {
  const [expanded, setExpanded] = useState(false);
  const close = useMemo(() => () => setExpanded(false), []);
  const { mounted, visible } = useExpandedModal(expanded, close);

  const hasContent = !!file;

  const cleanedContent = useMemo(() => {
    if (!file) return "";
    return file.content.replace(/^---[\s\S]*?---\s*/m, "").trimStart();
  }, [file]);

  const { title: extractedTitle, body: contentBody } = useMemo(
    () => splitFirstH1(cleanedContent),
    [cleanedContent],
  );

  const displayTitle = file ? (extractedTitle ?? file.frontmatter.title ?? null) : null;

  const connectedPages = useMemo(
    () => (file ? getConnectedPages(file, allFiles) : []),
    [file, allFiles],
  );

  const pathLookup = useMemo(() => buildBrianPathLookup(allFiles), [allFiles]);

  const mdComponents = useMemo<Components>(
    () => ({
      ...markdownComponentsBase,
      a: ({ href, children, title }) => {
        if (!href?.trim()) {
          return <span className={linkLikeClass}>{children}</span>;
        }
        if (isExternalOrNonBrainHref(href)) {
          if (/^https?:\/\//i.test(href.trim())) {
            return (
              <a
                href={href}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
                className={linkLikeClass}
              >
                {children}
              </a>
            );
          }
          return (
            <a href={href} title={title} className={linkLikeClass}>
              {children}
            </a>
          );
        }
        const target = resolveBrainLinkHref(href, file?.path ?? null, pathLookup);
        if (target) {
          return (
            <button
              type="button"
              title={title ?? target.path}
              className={cn(
                linkLikeClass,
                "inline cursor-pointer border-0 bg-transparent p-0 text-left font-inherit",
              )}
              onClick={() => onSelectSource(target.path)}
            >
              {children}
            </button>
          );
        }
        return (
          <span
            className={cn(linkLikeClass, "cursor-help opacity-55")}
            title={`No matching brain file loaded for “${href}”. It may be missing from the agent workspace.`}
          >
            {children}
          </span>
        );
      },
    }),
    [file?.path, pathLookup, onSelectSource],
  );

  const answerBlock = lastAnswer ? (
    <div className="space-y-4">
      <div className="max-w-none">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
          Assistant
        </p>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {lastAnswer.markdown}
        </ReactMarkdown>
      </div>

      {lastAnswer.sources?.length ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
            Sources
          </p>
          <div className="flex flex-wrap gap-2">
            {lastAnswer.sources.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSelectSource(s)}
                className={cn(
                  "rounded-full border border-black/10 bg-white/70 px-3 py-1 text-[11px] font-medium text-black/75 transition",
                  "hover:bg-white hover:text-black",
                )}
                style={{ boxShadow: `inset 0 0 0 1px ${accentForPath(s)}33` }}
                title={s}
              >
                <span className="font-mono">{s}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  const body = (sized: "inline" | "expanded") => (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", sized === "expanded" ? "px-10 py-8" : "px-5 py-5")}>
      {file ? (
        <div className="max-w-none space-y-8">
          <div>
            {displayTitle ? (
              <h1 className="mt-0 mb-3 text-2xl font-semibold tracking-tight text-black">
                {displayTitle}
              </h1>
            ) : null}

            <ConnectedPagesList
              pages={connectedPages}
              accentForPath={accentForPath}
              onSelect={onSelectSource}
            />

            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {contentBody}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-center text-black/55">
          <div>
            <p className="text-sm font-medium text-black/70">Select a node</p>
            <p className="mt-1 text-xs text-black/45">
              Choose a file from the left or a node in the graph.
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const header = (variant: "inline" | "expanded") => (
    <div className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3">
      <div className="flex shrink-0 items-center gap-2">
        <FileText size={14} className="text-black/70" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
          Preview
        </p>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {file?.path ? (
          <span
            className="min-w-0 max-w-[240px] truncate rounded-full bg-black/[0.06] px-3 py-1 font-mono text-[10px] text-black/70"
            title={file.path}
          >
            {file.path}
          </span>
        ) : null}
        {hasContent ? (
          variant === "inline" ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="shrink-0 rounded-lg border border-black/10 bg-white/60 p-1.5 text-black/65 transition hover:bg-white hover:text-black"
              title="Expand preview"
              aria-label="Expand preview"
            >
              <Maximize2 size={12} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="shrink-0 rounded-lg border border-black/10 bg-white/60 p-1.5 text-black/65 transition hover:bg-white hover:text-black"
                title="Collapse preview"
                aria-label="Collapse preview"
              >
                <Minimize2 size={12} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="shrink-0 rounded-lg border border-black/10 bg-white/60 p-1.5 text-black/65 transition hover:bg-white hover:text-black"
                title="Close"
                aria-label="Close"
              >
                <X size={12} />
              </button>
            </>
          )
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        {header("inline")}
        {body("inline")}
      </div>

      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-10"
              role="dialog"
              aria-modal="true"
            >
              <div
                className={cn(
                  "absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ease-out",
                  visible ? "opacity-100" : "opacity-0",
                )}
                onClick={() => setExpanded(false)}
              />
              <div
                className={cn(
                  "relative flex h-full max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden",
                  "rounded-2xl border border-black/10 bg-[#f4f4f6] shadow-2xl shadow-black/20",
                  "transition-all ease-out will-change-transform",
                  visible
                    ? "opacity-100 scale-100 translate-y-0"
                    : "opacity-0 scale-[0.96] translate-y-2",
                )}
                style={{ transitionDuration: "220ms" }}
              >
                {header("expanded")}
                {body("expanded")}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
