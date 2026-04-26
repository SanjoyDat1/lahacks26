import { NextResponse } from "next/server";

import { clearGoogleSessionCookie } from "@/lib/integrations/google/session-cookie";

export async function POST() {
  await clearGoogleSessionCookie();
  return NextResponse.json({ ok: true });
}
