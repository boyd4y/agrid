import { inTransaction as backendTransaction } from "@tabdo/backend/database/context";
import { runtimeDependencies, backendCall } from "../services/backend-facade.js";
import type { Transaction } from "@tabdo/backend/database/context";
export type { Transaction, Database } from "@tabdo/backend/database/context";

/** Compatibility composition; caller transactions remain the shared service's transaction. */
export function inTransaction<T>(transaction: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return backendCall(() => backendTransaction(runtimeDependencies(), transaction, work));
}
