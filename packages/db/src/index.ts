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
  logger?: { logQuery(query: string, params: unknown[]): void };
}) {
  if (!options.connectionString) throw new Error("Missing database connection string");
  if (!Number.isInteger(options.poolMax) || options.poolMax < 1) throw new Error("Invalid database pool size");
  const client = postgres(options.connectionString, { max: options.poolMax, connect_timeout: 5, idle_timeout: 20,
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
  });
  const db = drizzle(client, { schema: options.schema, logger: options.logger });
  type Tx = Transaction<Schema>;
  type Effects = Map<string, () => void>;
  const pending = new WeakMap<object, Effects>();
  function track(tx: Tx, effects: Effects) {
    pending.set(tx, effects);
    const savepoint = tx.transaction.bind(tx);
    tx.transaction = async work => {
      const child: Effects = new Map();
      const value = await savepoint(async nested => {
        track(nested, child);
        try { return await work(nested); } finally { pending.delete(nested); }
      });
      for (const [key, effect] of child) effects.set(key, effect);
      return value;
    };
  }
  const begin = db.transaction.bind(db);
  db.transaction = async (work, config) => {
    const effects: Effects = new Map();
    const value = await begin(async tx => {
      track(tx, effects);
      try { return await work(tx); } finally { pending.delete(tx); }
    }, config);
    // Dispatch is best effort. The committed transaction must remain successful.
    for (const effect of effects.values()) {
      try { effect(); } catch { /* Durable outbox/recovery is owned by the caller. */ }
    }
    return value;
  };
  return Object.freeze({ client, db, close: () => client.end(),
    afterCommit(tx: Tx, key: string, effect: () => void) {
      const effects = pending.get(tx);
      if (!effects) throw new Error("Commit effects require an active transaction from this database resource");
      effects.set(key, effect);
    },
  });
}
export type DatabaseResource<Schema extends Record<string, unknown>> = ReturnType<typeof createDatabase<Schema>>;
