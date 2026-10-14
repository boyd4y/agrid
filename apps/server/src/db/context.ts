import { HTTPException } from "hono/http-exception";
import { getDatabase } from "@tabdo/backend/resources";
import type { PlatformDatabase } from "@tabdo/backend/database";
import { nameConflictMessage } from "./name-errors.js";

export type Transaction = Parameters<Parameters<PlatformDatabase["transaction"]>[0]>[0];
export type Database = PlatformDatabase | Transaction;

/** Compose command side effects and their caller's receipt in one transaction. */
export function inTransaction<T>(transaction: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return (transaction ? work(transaction) : getDatabase().transaction(work)).catch(error => {
    const message = nameConflictMessage(error);
    if (message) throw new HTTPException(409, { message, res: Response.json({ error: message }, { status: 409 }) });
    throw error;
  });
}
