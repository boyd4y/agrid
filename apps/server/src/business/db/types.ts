import type { ServerDatabase } from "./factory.js";

/** Business queries may compose with a caller-owned transaction without owning its connection. */
export type Transaction = Parameters<Parameters<ServerDatabase["transaction"]>[0]>[0];
export type Database = ServerDatabase | Transaction;
