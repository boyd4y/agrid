import type { DatabaseDependencies } from "../dependencies.js";
import { ServiceError } from "../errors.js";

import type { ServerDatabase } from "./factory.js";
import { nameConflictMessage } from "./name-errors.js";

export type Transaction = Parameters<Parameters<ServerDatabase["transaction"]>[0]>[0];
export type Database = ServerDatabase | Transaction;

/** Compose command side effects and their caller's receipt in one transaction. */
export function inTransaction<T>(deps: DatabaseDependencies, transaction: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return (transaction ? work(transaction) : deps.database.transaction(work)).catch(error => {
    const message = nameConflictMessage(error);
    if (message) throw new ServiceError(409, { message });
    throw error;
  });
}
