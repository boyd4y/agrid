import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Platform resource factory. The caller owns its lifetime and supplies every setting. */
export function createDatabase(options: {
  connectionString: string;
  poolMax: number;
  prepare?: boolean;
}) {
  if (!options.connectionString) throw new Error("Missing database connection string");
  if (!Number.isInteger(options.poolMax) || options.poolMax < 1) throw new Error("Invalid database pool size");
  const client = postgres(options.connectionString, { max: options.poolMax, connect_timeout: 5, idle_timeout: 20,
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
  });
  return Object.freeze({ client, db: drizzle(client, { schema }), close: () => client.end() });
}
export type PlatformDatabase = ReturnType<typeof createDatabase>["db"];
export type DatabaseResource = ReturnType<typeof createDatabase>;
