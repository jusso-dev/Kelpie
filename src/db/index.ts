import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://kelpie:kelpie@localhost:5432/kelpie";

declare global {
  // eslint-disable-next-line no-var
  var __kelpie_pg: ReturnType<typeof postgres> | undefined;
}

const client =
  globalThis.__kelpie_pg ??
  postgres(connectionString, { max: 10, prepare: false });

if (process.env.NODE_ENV !== "production") {
  globalThis.__kelpie_pg = client;
}

export const db = drizzle(client, { schema });
export { schema };
