"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function Nav() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/agent/stream");
        const data = (await res.json()) as { offline?: boolean };
        if (!cancelled) setOnline(data.offline === true ? false : true);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }
    void check();
    const t = window.setInterval(check, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-white/55 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-3">
        <Link href="/" className="group flex items-center gap-2">
          <span className="text-[13px] font-semibold tracking-tight text-black/90">Brian</span>
          <span className="hidden text-[11px] text-black/55 sm:inline">company knowledge</span>
        </Link>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 text-[11px] text-black/55 sm:flex">
            <span
              className={cn(
                "inline-flex h-1.5 w-1.5 rounded-full",
                online === null
                  ? "bg-black/30"
                  : online
                    ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.45)]"
                    : "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.35)]",
              )}
            />
            {online === null ? "Checking agent…" : online ? "Agent online" : "Agent offline"}
          </span>
          <Link
            href="/brain"
            className="rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-black/75 transition hover:bg-white hover:text-black"
          >
            Open map
          </Link>
        </div>
      </div>
    </header>
  );
}
