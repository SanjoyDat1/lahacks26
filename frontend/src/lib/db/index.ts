import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

let client: postgres.Sql | undefined;

export function getDb() {
  if (!env.databaseUrl) return undefined;

  client ??= postgres(env.databaseUrl, {
    max: 3,
    prepare: false,
  });

  return drizzle(client, { schema });
}
