"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowRight, Brain, Search, Sparkles, X } from "lucide-react";

type Result = {
  document: {
    id: string;
    source: string;
    text: string;
    sourceUrl?: string;
  };
  score: number;
};

const EXAMPLE_QUERIES = [
  "How does authentication work?",
  "What database decisions were made?",
  "API rate limits and constraints",
  "Recent architecture changes",
];

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function search(q?: string) {
    const text = (q ?? query).trim();
    if (!text) return;
    startTransition(async () => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`);
      const data = (await response.json()) as { results: Result[] };
      setResults(data.results);
    });
  }

  function clear() {
    setQuery("");
    setResults(null);
    inputRef.current?.focus();
  }

  const hasResults = results !== null;

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-5 py-4 shadow-md backdrop-blur-2xl ring-2 ring-transparent transition-all focus-within:border-violet-400/60 focus-within:ring-violet-400/15">
          <Search size={18} className="flex-shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder="Ask a question about your codebase…"
            className="flex-1 bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
            autoFocus
          />
          {query && (
            <button onClick={clear} className="flex-shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
              <X size={15} />
            </button>
          )}
          <button
            onClick={() => search()}
            disabled={!query.trim() || isPending}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-40"
          >
            {isPending ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Searching
              </span>
            ) : (
              <>Search <ArrowRight size={13} /></>
            )}
          </button>
        </div>
      </div>

      {/* Example queries */}
      {!hasResults && !isPending && (
        <div>
          <p className="mb-2.5 text-xs font-medium text-slate-400">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => { setQuery(q); search(q); }}
                className="flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/70 px-3.5 py-2 text-xs text-slate-600 transition hover:bg-white hover:border-violet-300/60 hover:text-violet-700"
              >
                <Sparkles size={10} className="text-violet-400" />
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-4">
          {/* Result count header */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {results.length === 0
                ? "No results found"
                : `${results.length} result${results.length > 1 ? "s" : ""} for "${query}"`}
            </p>
            <button onClick={clear} className="text-xs text-violet-600 hover:text-violet-700 transition-colors">
              Clear
            </button>
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/80 bg-white/65 p-10 text-center shadow-sm backdrop-blur-xl">
              <Brain size={28} className="text-slate-300" />
              <div>
                <p className="text-sm font-medium text-slate-600">Nothing found</p>
                <p className="mt-1 text-xs text-slate-400">
                  Try different keywords, or seed demo events to populate the memory.
                </p>
              </div>
            </div>
          ) : (
            results.map((result, i) => (
              <ResultCard key={result.document.id} result={result} rank={i + 1} query={query} />
            ))
          )}
        </div>
      )}

      {/* How this works */}
      {!hasResults && !isPending && (
        <div className="rounded-2xl border border-slate-200/50 bg-white/50 p-5 backdrop-blur-xl">
          <p className="text-xs font-semibold text-slate-600 mb-3">How semantic search works</p>
          <div className="space-y-2.5">
            {[
              { icon: "1", text: "Your query is converted into an embedding (a mathematical representation of meaning)" },
              { icon: "2", text: "We compare it against embeddings of all captured events using cosine similarity" },
              { icon: "3", text: "Results are ranked by how closely the meaning matches — not just keyword overlap" },
            ].map(({ icon, text }) => (
              <div key={icon} className="flex items-start gap-2.5">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-600 mt-0.5">{icon}</span>
                <p className="text-[11px] leading-5 text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({ result, rank, query }: { result: Result; rank: number; query: string }) {
  const scorePercent = Math.round(result.score * 100);
  const scoreColor =
    scorePercent >= 80 ? "bg-emerald-400" :
    scorePercent >= 60 ? "bg-amber-400" :
    "bg-slate-300";
  const scoreLabel =
    scorePercent >= 80 ? "High relevance" :
    scorePercent >= 60 ? "Moderate relevance" :
    "Low relevance";

  // Highlight query terms in text
  const highlightText = (text: string) => {
    const words = query.split(/\s+/).filter((w) => w.length > 2);
    if (!words.length) return text;
    const regex = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.replace(regex, "**$1**");
  };

  const highlighted = highlightText(result.document.text);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/80 bg-white/70 shadow-sm backdrop-blur-xl transition-all hover:bg-white/90 hover:shadow-md">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-100/80 px-5 py-3">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">
          {rank}
        </span>
        <SourcePill source={result.document.source} />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-semibold text-slate-500">{scoreLabel}</span>
            <div className="flex items-center gap-1.5">
              <div className="h-1 w-20 overflow-hidden rounded-full bg-slate-200/60">
                <div className={`h-full rounded-full transition-all ${scoreColor}`} style={{ width: `${scorePercent}%` }} />
              </div>
              <span className="text-[10px] font-bold tabular-nums text-slate-500">{scorePercent}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {highlighted.split("**").map((part, i) =>
            i % 2 === 1
              ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-800 not-italic font-medium">{part}</mark>
              : <span key={i}>{part}</span>
          )}
        </p>
        {result.document.sourceUrl && (
          <a
            href={result.document.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-700 hover:underline"
          >
            View source <ArrowRight size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  github:   { bg: "bg-slate-800",   text: "text-white",         label: "GitHub"  },
  gitlab:   { bg: "bg-orange-500",  text: "text-white",         label: "GitLab"  },
  slack:    { bg: "bg-emerald-500", text: "text-white",         label: "Slack"   },
  discord:  { bg: "bg-indigo-500",  text: "text-white",         label: "Discord" },
  meetings: { bg: "bg-blue-500",    text: "text-white",         label: "Meeting" },
  custom:   { bg: "bg-slate-200",   text: "text-slate-600",     label: "Custom"  },
};

function SourcePill({ source }: { source: string }) {
  const s = SOURCE_COLORS[source] ?? SOURCE_COLORS.custom;
  return (
    <span className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}
