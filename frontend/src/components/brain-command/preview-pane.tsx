"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";

import type { Components } from "react-markdown";

import { uniqueBrainFileLabels } from "@/lib/brain/brain-file-label";
import type { BrianFile } from "@/lib/brian/reader";
import {
  buildBrianPathLookup,
  isExternalOrNonBrainHref,
  resolveBrainLinkHref,
} from "@/lib/brian/resolve-markdown-link";
import { divisionKeyForPath, divisionTodosPathForKey } from "@/lib/brain/divisions";
import { cn } from "@/lib/utils";
import { mdComponents, useExpandedModal } from "./markdown-components";

type ConnectedPage = {
  file: BrianFile;
  direction: "out" | "in";
};

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
  labelByPath,
  chipMaxWidthClass = "max-w-[160px]",
}: {
  pages: ConnectedPage[];
  accentForPath: (path: string) => string;
  onSelect: (path: string) => void;
  labelByPath: Map<string, string>;
  chipMaxWidthClass?: string;
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
          const label = labelByPath.get(linked.path) ?? linked.path;
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
              <span className={cn("truncate", chipMaxWidthClass)}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const linkLikeClass =
  "text-[color:var(--accent-700)] underline decoration-black/20 underline-offset-2 hover:decoration-[color:var(--accent-700)]";

export function PreviewPane({
  file,
  onSelectSource,
  accentForPath,
  allFiles = [],
  layoutWide = false,
  onToggleLayoutWide,
}: {
  file: BrianFile | null;
  onSelectSource: (titleOrPath: string) => void;
  accentForPath: (path: string) => string;
  allFiles?: BrianFile[];
  /** Parent grid widens the preview column; tune typography and chips. */
  layoutWide?: boolean;
  onToggleLayoutWide?: () => void;
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

  const divisionTodo = useMemo(() => {
    if (!file) return null;
    const todoPath = divisionTodosPathForKey(divisionKeyForPath(file.path));
    if (!todoPath) return null;
    const f = allFiles.find((x) => x.path === todoPath) ?? null;
    if (!f || f.path === file.path) return null;
    return f;
  }, [file, allFiles]);

  const pathLookup = useMemo(() => buildBrianPathLookup(allFiles), [allFiles]);
  const labelByPath = useMemo(
    () => uniqueBrainFileLabels(allFiles.length ? allFiles : file ? [file] : []),
    [allFiles, file],
  );

  const previewMarkdownComponents = useMemo<Components>(
    () => ({
      ...mdComponents,
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
            title={`No matching Brian page loaded for “${href}”. It may be missing from the agent workspace.`}
          >
            {children}
          </span>
        );
      },
    }),
    [file?.path, pathLookup, onSelectSource],
  );

  const body = (sized: "inline" | "expanded") => (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto scroll-smooth",
        sized === "expanded"
          ? "px-10 py-8"
          : layoutWide
            ? "px-7 py-6"
            : "px-5 py-5",
      )}
    >
      {file ? (
        <div
          className={cn(
            "max-w-none space-y-8 transition-[font-size] duration-500 ease-out",
            layoutWide && sized === "inline" && "text-[15px] leading-relaxed [&_.prose]:max-w-none",
          )}
        >
          <div>
            {displayTitle ? (
              <h1
                className={cn(
                  "mt-0 mb-3 font-semibold tracking-tight text-black transition-[font-size] duration-500 ease-out",
                  sized === "expanded" ? "text-2xl" : layoutWide ? "text-[1.65rem]" : "text-2xl",
                )}
              >
                {displayTitle}
              </h1>
            ) : null}

            {divisionTodo ? (
              <div
                className="mb-5 rounded-2xl border border-violet-200/80 bg-violet-50/60 px-4 py-3"
                style={{ boxShadow: `inset 0 0 0 1px ${accentForPath(divisionTodo.path)}22` }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-900/80">
                    Division checklist
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectSource(divisionTodo.path)}
                    className="shrink-0 text-[10px] font-semibold text-violet-800 underline decoration-violet-300 underline-offset-2 hover:text-violet-950"
                  >
                    Open full
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto text-[12px] leading-relaxed text-black/80 [&_ul]:my-0 [&_li]:text-black/80">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      ...previewMarkdownComponents,
                    }}
                  >
                    {divisionTodo.content.replace(/^---[\s\S]*?---\s*/m, "").trimStart()}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}

            <ConnectedPagesList
              pages={connectedPages}
              accentForPath={accentForPath}
              onSelect={onSelectSource}
              labelByPath={labelByPath}
              chipMaxWidthClass={layoutWide ? "max-w-[min(280px,100%)]" : "max-w-[160px]"}
            />

            <div
              className={cn(
                "[&_pre]:rounded-xl [&_pre]:border [&_pre]:border-black/10",
                layoutWide && sized === "inline" && "[&_pre]:text-[13px] [&_table]:text-[14px]",
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={previewMarkdownComponents}>
                {contentBody}
              </ReactMarkdown>
            </div>
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
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        <FileText size={14} className="shrink-0 text-black/70" aria-hidden />
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
          Preview
        </p>
        {variant === "inline" && onToggleLayoutWide ? (
          <button
            type="button"
            onClick={onToggleLayoutWide}
            className={cn(
              "ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/80 text-black/55",
              "shadow-sm shadow-black/[0.03] transition-all duration-300 ease-out",
              "hover:border-black/14 hover:bg-white hover:text-black hover:shadow-md hover:shadow-black/[0.06]",
              "active:scale-[0.94]",
            )}
            title={layoutWide ? "Narrow preview panel" : "Widen preview panel"}
            aria-label={layoutWide ? "Narrow preview panel" : "Widen preview panel"}
            aria-pressed={layoutWide}
          >
            {layoutWide ? (
              <ChevronRight size={17} strokeWidth={2.25} className="transition-transform duration-300" />
            ) : (
              <ChevronLeft size={17} strokeWidth={2.25} className="transition-transform duration-300" />
            )}
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {file?.path ? (
          <span
            className={cn(
              "min-w-0 truncate rounded-full bg-black/[0.06] px-3 py-1 font-mono text-[10px] text-black/70 transition-[max-width] duration-500 ease-out",
              variant === "inline" && layoutWide ? "max-w-[min(380px,50vw)]" : "max-w-[240px]",
            )}
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
