import { AsyncLocalStorage } from "node:async_hooks";
import type { Transaction } from "../db/context.js";

const executionTransaction = new AsyncLocalStorage<Transaction>();

/** Scoped to a host DB operation; never wrap model or provider I/O. */
export function withToolTransaction<T>(transaction: Transaction | undefined, execute: () => Promise<T>): Promise<T> {
  return transaction ? executionTransaction.run(transaction, execute) : execute();
}

export function getToolTransaction(): Transaction | undefined {
  return executionTransaction.getStore();
}
