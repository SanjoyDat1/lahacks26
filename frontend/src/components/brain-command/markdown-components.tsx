import { useEffect, useState } from "react";
import type { Components } from "react-markdown";

import { cn } from "@/lib/utils";

export const mdComponents: Components = {
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
  a: ({ children, ...p }) => (
    <a {...p} className="text-[color:var(--accent-700)] underline decoration-black/20 underline-offset-2 hover:decoration-[color:var(--accent-700)]">
      {children}
    </a>
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

export function useExpandedModal(active: boolean, onClose: () => void) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    if (!mounted) return;
    const t = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [active, mounted]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active, onClose]);

  return { mounted, visible };
}
