import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type Database<Schema extends Record<string, unknown> = Record<string, never>> = PostgresJsDatabase<Schema>;
export type Transaction<Schema extends Record<string, unknown> = Record<string, never>> = Parameters<Parameters<Database<Schema>["transaction"]>[0]>[0];

/** Own one pool; the caller supplies its schema and owns shutdown. */
export function createDatabase<Schema extends Record<string, unknown>>(options: {
  connectionString: string;
  poolMax: number;
  schema: Schema;
  prepare?: boolean;
}) {
  if (!options.connectionString) throw new Error("Missing database connection string");
  if (!Number.isInteger(options.poolMax) || options.poolMax < 1) throw new Error("Invalid database pool size");
  const client = postgres(options.connectionString, { max: options.poolMax, connect_timeout: 5, idle_timeout: 20,
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
  });
  return Object.freeze({ client, db: drizzle(client, { schema: options.schema }), close: () => client.end() });
}
export type DatabaseResource<Schema extends Record<string, unknown>> = ReturnType<typeof createDatabase<Schema>>;
