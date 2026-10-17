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
  type Rollbacks = Map<string, () => void | Promise<void>>;
  const rollbacks = new WeakMap<object, Rollbacks>();
  async function undo(effects: Rollbacks) { await Promise.allSettled([...effects.values()].map(effect => Promise.resolve().then(effect))); }
  function track(tx: Tx, effects: Effects, rollback: Rollbacks) {
    rollbacks.set(tx, rollback);
    pending.set(tx, effects);
    const savepoint = tx.transaction.bind(tx);
    tx.transaction = async work => {
      const child: Effects = new Map();
      const childRollback: Rollbacks = new Map();
      let completed = false;
      try {
        const value = await savepoint(async nested => {
          track(nested, child, childRollback);
          try { const value = await work(nested); completed = true; return value; } finally { pending.delete(nested); rollbacks.delete(nested); }
        });
        for (const [key, effect] of child) effects.set(key, effect);
        for (const [key, effect] of childRollback) rollback.set(key, effect);
        return value;
      } catch (error) {
        if (completed) for (const [key, effect] of childRollback) rollback.set(key, effect);
        else await undo(childRollback);
        throw error;
      }
    };
  }
  const begin = db.transaction.bind(db);
  db.transaction = async (work, config) => {
    const effects: Effects = new Map();
    const rollback: Rollbacks = new Map();
    let value: Awaited<ReturnType<typeof work>>;
    let completed = false;
    try { value = await begin(async tx => {
      track(tx, effects, rollback);
      try { const result = await work(tx); completed = true; return result; } finally { pending.delete(tx); rollbacks.delete(tx); }
    }, config); } catch (error) {
      // A lost COMMIT acknowledgement is indeterminate. Never remove an object
      // that may already have a committed reference; its receipt can be retried.
      if (!completed) await undo(rollback);
      throw error;
    }
    // Dispatch is best effort. The committed transaction must remain successful.
    for (const effect of effects.values()) {
      try { effect(); } catch { /* Durable outbox/recovery is owned by the caller. */ }
    }
    return value;
  };
  return Object.freeze({ client, db, close: () => client.end(),
    afterRollback(tx: Tx, key: string, effect: () => void | Promise<void>) {
      const effects = rollbacks.get(tx);
      if (!effects) throw new Error("Rollback effects require an active transaction from this database resource");
      effects.set(key, effect);
    },
    afterCommit(tx: Tx, key: string, effect: () => void) {
      const effects = pending.get(tx);
      if (!effects) throw new Error("Commit effects require an active transaction from this database resource");
      effects.set(key, effect);
    },
  });
}
export type DatabaseResource<Schema extends Record<string, unknown>> = ReturnType<typeof createDatabase<Schema>>;
