import "../load-env.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const DEV_DATABASE_URL =
  "postgresql://tableapp:tableapp@localhost:5432/tableapp";
const isProd = process.env.NODE_ENV === "production";
const connectionString = process.env.DATABASE_URL ?? (isProd ? "" : DEV_DATABASE_URL);
if (!connectionString) {
  throw new Error("DATABASE_URL must be set in production");
}

const poolMax = Number(process.env.DB_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error("Invalid DB_POOL_MAX");
const client = postgres(connectionString, { max: poolMax, connect_timeout: 5, idle_timeout: 20 });
export const db = drizzle(client, { schema });
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Database = typeof db | Transaction;
export { client };

/** Compose command side effects and their caller's receipt in one transaction. */
export function inTransaction<T>(transaction: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return transaction ? work(transaction) : db.transaction(work);
}
