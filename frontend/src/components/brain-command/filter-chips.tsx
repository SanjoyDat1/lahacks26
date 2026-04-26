"use client";

import { cn } from "@/lib/utils";
import { CATEGORY_SHADES, type BrainCategory } from "@/lib/brain/categories";

export function FilterChips({
  categories,
  active,
  onChange,
}: {
  categories: BrainCategory[];
  active: Set<BrainCategory>;
  onChange: (next: Set<BrainCategory>) => void;
}) {
  const noneSelected = active.size === 0;

  function toggle(cat: BrainCategory) {
    const next = new Set(active);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {categories.map((cat) => {
        const on = active.has(cat);
        const dim = !noneSelected && !on;
        const tint = CATEGORY_SHADES[cat] ?? CATEGORY_SHADES.other;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => toggle(cat)}
            className={cn(
              "group inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium tracking-[-0.02em] transition",
              on
                ? "border-black/15 bg-black/85 text-white"
                : dim
                  ? "border-black/5 bg-white/55 text-[color:var(--fg-dim)] opacity-60 hover:opacity-100 hover:text-black"
                  : "border-black/10 bg-white/70 text-[color:var(--fg-muted)] hover:bg-white/90 hover:text-black",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition",
                on ? "opacity-100" : dim ? "opacity-50" : "opacity-70 group-hover:opacity-90",
              )}
              style={{ background: tint }}
            />
            <span className="capitalize">{cat}</span>
          </button>
        );
      })}
    </div>
  );
}

