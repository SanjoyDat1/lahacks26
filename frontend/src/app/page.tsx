import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SessionStartPage } from "@/components/start/session-start-page";
import { readBrianFiles } from "@/lib/brian/reader";

export default function Home() {
  const files = readBrianFiles();
  const hasBrain = files.length > 0;

  return (
    <>
      {hasBrain ? (
        <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/80 px-4 py-2.5 backdrop-blur-xl">
          <Link
            href="/brain"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 transition hover:text-slate-900"
          >
            <ChevronLeft size={14} />
            Back to brain map
          </Link>
        </header>
      ) : null}
      <SessionStartPage />
    </>
  );
}
