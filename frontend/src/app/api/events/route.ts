import { NextResponse } from "next/server";

import { listEvents } from "@/lib/db/store";

export async function GET() {
  const events = await listEvents(100);
  return NextResponse.json({ events });
}
