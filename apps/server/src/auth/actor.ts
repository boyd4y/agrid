import { createHash } from "node:crypto";
import { getAuth, getDatabase } from "../resources/scope.js";
import { resolveActor as resolveBackendActor, listOrgMembers as listBackendOrgMembers } from "../business/auth/actor.js";
import type { Transaction } from "../db/context.js";

export type { Actor } from "../business/auth/actor.js";
export { organization } from "../business/auth/actor.js";

/** Compatibility for existing Node key creation. Identity services use Web Crypto directly. */
export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

/** Application entry facade; the shared service receives resources explicitly. */
export function resolveActor(req: Request) {
  return resolveBackendActor(req, {
    database: getDatabase(),
    // Resolve lazily so Bearer credentials also work in a database-only job scope.
    resolveSession: headers => getAuth().api.getSession({ headers }),
    logger: { warn: (event, error) => console.warn(event, error) },
  });
}

export function listOrgMembers(organizationId: string, transaction?: Transaction) {
  return listBackendOrgMembers(organizationId, { database: transaction ?? getDatabase() });
}
