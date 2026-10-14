import type { PlatformDatabase } from "./factory.js";

/** Business queries may compose with a caller-owned transaction without owning its connection. */
export type Transaction = Parameters<Parameters<PlatformDatabase["transaction"]>[0]>[0];
export type Database = PlatformDatabase | Transaction;
