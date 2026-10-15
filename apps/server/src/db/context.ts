import { inTransaction as backendTransaction } from "../business/db/context.js";
import { runtimeDependencies, businessCall } from "../services/dependencies.js";
import type { Transaction } from "../business/db/context.js";
export type { Transaction, Database } from "../business/db/context.js";

/** Compatibility composition; caller transactions remain the shared service's transaction. */
export function inTransaction<T>(transaction: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return businessCall(() => backendTransaction(runtimeDependencies(), transaction, work));
}
