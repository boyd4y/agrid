import "../load-env.js";
import { createDatabase } from "../business/db/factory.js";

const DEV_DATABASE_URL =
  "postgresql://tableapp:tableapp@localhost:5432/tableapp";
const isProd = process.env.NODE_ENV === "production";
const connectionString = process.env.DATABASE_URL ?? (isProd ? "" : DEV_DATABASE_URL);
if (!connectionString) {
  throw new Error("DATABASE_URL must be set in production");
}

const poolMax = Number(process.env.DB_POOL_MAX ?? 10);
if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error("Invalid DB_POOL_MAX");
export const nodeDatabase = createDatabase({ connectionString, poolMax });
const resource = nodeDatabase;
const client = resource.client;
export const db = resource.db;
export type { Transaction, Database } from "./context.js";
export { inTransaction } from "./context.js";
export { client };
