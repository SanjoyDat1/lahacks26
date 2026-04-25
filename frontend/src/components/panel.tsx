import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-white/80 bg-white/65 p-6",
        "shadow-sm shadow-black/[0.04] backdrop-blur-2xl",
        "[box-shadow:inset_0_1px_0_rgba(255,255,255,0.9),_0_4px_24px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-violet-300/60 bg-violet-100/80 px-3.5 py-1.5 text-xs font-medium text-violet-700">
      {children}
    </span>
  );
}
