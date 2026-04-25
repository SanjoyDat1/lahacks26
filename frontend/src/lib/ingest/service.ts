import { createEvent } from "@/lib/db/store";
import { distillEvent } from "@/lib/distiller";
import { normalizeEvent } from "@/lib/ingest/normalizers";
import type { SourceType } from "@/lib/types";

export async function ingestPayload(source: SourceType, payload: unknown) {
  const normalized = normalizeEvent(source, payload);
  const event = await createEvent(normalized);
  const brainUpdate = await distillEvent(event);

  return {
    event,
    brainUpdate,
  };
}
