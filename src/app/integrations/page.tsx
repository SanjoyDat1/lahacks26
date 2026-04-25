import { Copy } from "lucide-react";

import { Panel } from "@/components/panel";
import { listIntegrations } from "@/lib/db/store";

export default async function IntegrationsPage() {
  const integrations = await listIntegrations();

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-10">
        <span className="inline-flex rounded-full border border-emerald-300/60 bg-emerald-100/80 px-3 py-1 text-xs font-medium text-emerald-700">
          Setup
        </span>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">Webhook integrations</h1>
        <p className="mt-3 max-w-2xl text-base text-slate-500">
          Point each external tool at its endpoint. Add secrets in Vercel env vars to turn on signature verification.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((integration) => (
          <Panel key={integration.source} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">{integration.displayName}</h2>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  integration.status === "active"
                    ? "border-emerald-200/60 bg-emerald-50 text-emerald-700"
                    : "border-slate-200/60 bg-slate-100/80 text-slate-500"
                }`}
              >
                {integration.status}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-sm">
              <code className="flex-1 overflow-auto text-slate-700">{integration.webhookUrl}</code>
              <button className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600">
                <Copy size={14} />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Last event:{" "}
              {integration.lastEventAt
                ? new Date(integration.lastEventAt).toLocaleString()
                : "none yet"}
            </p>
          </Panel>
        ))}
      </div>
    </main>
  );
}
