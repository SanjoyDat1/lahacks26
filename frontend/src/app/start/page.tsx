import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SessionStartPage } from "@/components/start/session-start-page";

export default function StartPage() {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/80 px-4 py-2.5 backdrop-blur-xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 transition hover:text-slate-900"
        >
          <ChevronLeft size={14} />
          Home
        </Link>
      </header>
      <SessionStartPage />
    </>
  );
}
