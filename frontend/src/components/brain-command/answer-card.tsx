"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Maximize2, Minimize2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { mdComponents, useExpandedModal } from "./markdown-components";

export type Answer = { markdown: string; sources: string[] };

type Props = {
  answer: Answer | null;
  onSelectSource: (titleOrPath: string) => void;
  accentForPath: (path: string) => string;
  attached?: boolean;
  onClose?: () => void;
};

export function AnswerCard({ answer, onSelectSource, accentForPath, attached = false, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const close = useMemo(() => () => setExpanded(false), []);
  const { mounted, visible } = useExpandedModal(expanded, close);

  if (!answer) return null;

  const sources = answer.sources?.length ? (
    <div className="border-t border-black/[0.06] px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
        Sources
      </p>
      <div className="flex flex-wrap gap-2">
        {answer.sources.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              onSelectSource(s);
              setExpanded(false);
            }}
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
  ) : null;

  const markdown = (
    <div className="max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {answer.markdown}
      </ReactMarkdown>
    </div>
  );

  return (
    <>
      <div
        className={cn(
          "flex max-h-[40vh] flex-col overflow-hidden border border-black/10 bg-white/85 backdrop-blur-md",
          attached
            ? "rounded-t-2xl rounded-b-none border-b-0 shadow-none"
            : "rounded-2xl shadow-lg",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
            Assistant
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="shrink-0 rounded-lg border border-black/10 bg-white/70 p-1.5 text-black/65 transition hover:bg-white hover:text-black"
              title="Expand response"
              aria-label="Expand response"
            >
              <Maximize2 size={11} />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg border border-black/10 bg-white/70 p-1.5 text-black/65 transition hover:bg-white hover:text-black"
                title="Dismiss response"
                aria-label="Dismiss response"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{markdown}</div>
        {sources}
      </div>

      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[110] flex items-center justify-center p-6 sm:p-10"
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
                  "relative flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden",
                  "rounded-2xl border border-black/10 bg-[#f4f4f6] shadow-2xl shadow-black/20",
                  "transition-all ease-out will-change-transform",
                  visible
                    ? "opacity-100 scale-100 translate-y-0"
                    : "opacity-0 scale-[0.96] translate-y-2",
                )}
                style={{ transitionDuration: "220ms" }}
              >
                <div className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/55">
                    Assistant
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(false)}
                      className="shrink-0 rounded-lg border border-black/10 bg-white/60 p-1.5 text-black/65 transition hover:bg-white hover:text-black"
                      title="Collapse response"
                      aria-label="Collapse response"
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
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">{markdown}</div>
                {sources}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
