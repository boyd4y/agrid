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

const client = postgres(connectionString, { max: 10 });
export const db = drizzle(client, { schema });
export { client };
