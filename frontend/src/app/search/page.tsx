import { SearchClient } from "@/components/search-client";

export default function SearchPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-10 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-violet-600 mb-3">
          Semantic Memory
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Search what the AI knows
        </h1>
        <p className="mt-3 text-base leading-7 text-slate-500">
          Every event your team generates is embedded and stored. Ask a question in plain English — the system finds relevant context by meaning, not just keywords.
        </p>
      </div>
      <SearchClient />
    </main>
  );
}
