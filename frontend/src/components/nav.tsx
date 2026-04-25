"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, LayoutDashboard, Radio, Search } from "lucide-react";

import { cn } from "@/lib/utils";

const links = [
  { href: "/",        label: "Dashboard", Icon: LayoutDashboard },
  { href: "/brain",   label: "Brain",     Icon: Brain           },
  { href: "/events",  label: "Events",    Icon: Radio           },
  { href: "/search",  label: "Search",    Icon: Search          },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/75 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 py-3">
        {/* Brand */}
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <div className="absolute inset-0 rounded-xl bg-violet-500 opacity-10 transition group-hover:opacity-20" />
            <div className="absolute inset-0 rounded-xl ring-1 ring-violet-400/30" />
            <Brain size={16} className="relative text-violet-600" />
          </div>
          <div>
            <span className="text-[13px] font-semibold tracking-tight text-slate-900">AI Brain</span>
            <span className="ml-1.5 hidden text-[11px] text-slate-400 sm:inline">for coding agents</span>
          </div>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center rounded-2xl border border-slate-200/60 bg-white/80 p-1 shadow-sm backdrop-blur-xl">
          {links.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all duration-150",
                  active
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-100/80 hover:text-slate-800",
                )}
              >
                <Icon size={13} className={active ? "text-violet-200" : "text-slate-400"} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right: status indicator */}
        <div className="hidden items-center gap-2 text-[11px] text-slate-400 sm:flex">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
          System ready
        </div>
      </div>
    </header>
  );
}
