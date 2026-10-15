import { createDatabase as createPool } from "@tabdo/db";
import * as schema from "./schema.js";

/** Tabdo's complete schema is assembled only in the application. */
export function createDatabase(options: { connectionString: string; poolMax: number; prepare?: boolean }) {
  return createPool({ ...options, schema });
}
export type ServerDatabase = ReturnType<typeof createDatabase>["db"];
export type DatabaseResource = ReturnType<typeof createDatabase>;
