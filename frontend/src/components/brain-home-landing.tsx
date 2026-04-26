"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, GitBranch, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export function BrainHomeLanding({ hasBrain }: { hasBrain: boolean }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-violet-50/40">
      <div className="pointer-events-none absolute inset-0 canvas-dots opacity-[0.2]" />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-violet-300/25 blur-3xl" />
        <div className="absolute bottom-20 right-0 h-72 w-72 rounded-full bg-sky-300/20 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
        <div className="mb-5">
          <Image
            src="/brian-logo.png"
            alt="Brian"
            width={72}
            height={72}
            className="mx-auto h-[4.5rem] w-[4.5rem] object-contain drop-shadow-sm"
            priority
          />
        </div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-white/80 px-4 py-2 text-xs font-semibold text-violet-800 shadow-sm backdrop-blur-xl">
          <Sparkles size={14} className="text-violet-500" />
          Brian
        </div>

        <h1 className="text-center text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl md:text-6xl">
          Start from a clean session
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-center text-base leading-relaxed text-slate-600">
          Initialize Brian from a GitHub repo (and optional files). You will get the live session builder—clone, scan, distill, and graph—then open the full command center when you are ready.
        </p>

        <div className="mt-10 flex w-full max-w-md flex-col gap-3 sm:max-w-lg sm:flex-row sm:justify-center">
          <Link
            href="/start"
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-full px-8 py-4 text-sm font-semibold shadow-lg transition",
              "bg-violet-600 text-white shadow-violet-300/45 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-violet-400/50",
            )}
          >
            <GitBranch size={17} />
            Start new session
            <ArrowRight size={16} className="opacity-90" />
          </Link>

          <Link
            href="/brain"
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/90 px-8 py-4 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-xl transition",
              "hover:border-violet-200 hover:bg-white hover:text-slate-950",
              !hasBrain && "text-slate-500",
            )}
          >
            <Image
              src="/brian-logo.png"
              alt=""
              width={20}
              height={20}
              className={cn("h-5 w-5 object-contain", !hasBrain && "opacity-40")}
            />
            Open Brian map
          </Link>
        </div>

        {!hasBrain ? (
          <p className="mt-4 max-w-md text-center text-xs text-slate-500">
            No Brian files on disk yet—use <span className="font-semibold text-slate-700">Start new session</span> first, or open the map to see an empty workspace.
          </p>
        ) : (
          <p className="mt-4 max-w-md text-center text-xs text-slate-500">
            You already have Brian content. Open the map to browse and chat, or start another session to re-initialize (overwrites when you choose that in the builder).
          </p>
        )}
      </div>
    </div>
  );
}
