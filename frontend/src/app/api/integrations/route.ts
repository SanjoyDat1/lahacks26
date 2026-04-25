import { NextResponse } from "next/server";

import { listIntegrations } from "@/lib/db/store";

export async function GET() {
  const integrations = await listIntegrations();
  return NextResponse.json({ integrations });
}
