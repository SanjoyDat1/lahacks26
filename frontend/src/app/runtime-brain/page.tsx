import { BrainWorkspace } from "@/components/brain-workspace";
import { ensureBrainDefaults, readBrain } from "@/lib/brain/provider";
import { listBrainUpdates } from "@/lib/db/store";

export default async function RuntimeBrainPage() {
  await ensureBrainDefaults();
  const [files, updates] = await Promise.all([readBrain(), listBrainUpdates(20)]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-8">
        <span className="inline-flex rounded-full border border-violet-300/60 bg-violet-100/80 px-3 py-1 text-xs font-medium text-violet-700">
          Brian (runtime editor)
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
          AI-managed knowledge editor
        </h1>
        <p className="mt-3 max-w-3xl text-base text-slate-500">
          This is the operational knowledge base updated by the AI distiller. Human edits here commit to GitHub in production.
        </p>
      </div>
      <BrainWorkspace files={files} updates={updates} />
    </main>
  );
}
