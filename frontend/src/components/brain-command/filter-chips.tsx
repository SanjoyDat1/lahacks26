"use client";

import { cn } from "@/lib/utils";
import type { DivisionFilterOption } from "@/lib/brain/divisions";

export function FilterChips({
  options,
  active,
  onChange,
}: {
  options: DivisionFilterOption[];
  active: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const noneSelected = active.size === 0;

  function toggle(id: string) {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {options.map((opt) => {
        const on = active.has(opt.id);
        const dim = !noneSelected && !on;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle(opt.id)}
            title={opt.id}
            className={cn(
              "group inline-flex max-w-[200px] items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium tracking-[-0.02em] transition",
              on
                ? "border-black/15 bg-black/85 text-white"
                : dim
                  ? "border-black/5 bg-white/55 text-[color:var(--fg-dim)] opacity-60 hover:opacity-100 hover:text-black"
                  : "border-black/10 bg-white/70 text-[color:var(--fg-muted)] hover:bg-white/90 hover:text-black",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full transition",
                on ? "opacity-100" : dim ? "opacity-50" : "opacity-70 group-hover:opacity-90",
              )}
              style={{ background: opt.tint }}
            />
            <span className="min-w-0 truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

