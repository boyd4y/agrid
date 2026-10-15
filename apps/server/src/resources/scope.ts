import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseResource } from "../business/db/factory.js";
import type { Auth } from "@tabdo/auth";

/** A caller-owned resource scope, never inferred from environment or runtime. */
export type PlatformResources = Readonly<{
  database: DatabaseResource;
  auth?: Auth;
}>;

const resources = new AsyncLocalStorage<PlatformResources>();

/** The caller owns resource cleanup, including any detached work it starts. */
export function withPlatformResources<T>(value: PlatformResources, work: () => T): T {
  return resources.run(Object.freeze({ database: value.database, auth: value.auth }), work);
}

export function requirePlatformResources(): PlatformResources {
  const current = resources.getStore();
  if (!current) throw new Error("Platform resources must be supplied by the request or job entry point");
  return current;
}

export function getDatabase() {
  return requirePlatformResources().database.db;
}

export function getDatabaseClient() {
  return requirePlatformResources().database.client;
}

export function getAuth(): Auth {
  const auth = requirePlatformResources().auth;
  if (!auth) throw new Error("Authentication resources were not supplied for this operation");
  return auth;
}
