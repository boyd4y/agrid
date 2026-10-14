import { HTTPException } from "hono/http-exception";
import { nameConflictMessage } from "./name-errors.js";
import "../load-env.js";
import { createDatabase } from "@tabdo/platform/database";

const DEV_DATABASE_URL =
  "postgresql://tableapp:tableapp@localhost:5432/tableapp";
const isProd = process.env.NODE_ENV === "production";
const connectionString = process.env.DATABASE_URL ?? (isProd ? "" : DEV_DATABASE_URL);
if (!connectionString) {
  throw new Error("DATABASE_URL must be set in production");
}

const poolMax = Number(process.env.DB_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error("Invalid DB_POOL_MAX");
const resource = createDatabase({ connectionString, poolMax });
const client = resource.client;
export const db = resource.db;
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Database = typeof db | Transaction;
export { client };

/** Compose command side effects and their caller's receipt in one transaction. */
export function inTransaction<T>(transaction: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return (transaction ? work(transaction) : db.transaction(work)).catch(error => {
    const message = nameConflictMessage(error);
    if (message) throw new HTTPException(409, { message, res: Response.json({ error: message }, { status: 409 }) });
    throw error;
  });
}
