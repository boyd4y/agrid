import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { sha256 } from "@tabdo/core/crypto";
import type { SiteKeyInfo } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Database, Transaction } from "../db/types.js";
import { siteApiKeys, siteApiKeyTables, tables } from "../db/schema.js";
import { ServiceError } from "../errors.js";

export const siteKeyInput = z.strictObject({ name: z.string().trim().min(1).max(100),
  tableIds: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  canRead: z.boolean(), canCreate: z.boolean(),
}).refine(input => input.canRead || input.canCreate, "Choose at least one capability");
export type SitePrincipal = Readonly<{ id: string; organizationId: string; canRead: boolean; canCreate: boolean; tableIds: ReadonlySet<string> }>;
export type SiteRateLimit = (input: { keyId: string; ip: string; kind: "read" | "create" }) => Promise<void>;

function manager(actor: Actor) {
  if (!actor.organizationId || actor.kind !== "human" || !["owner", "admin"].includes(actor.role))
    throw new ServiceError(403, { message: "Only workspace owners and admins can manage site API keys" });
}
function id(value: string) { if (!z.uuid().safeParse(value).success) throw new ServiceError(404, { message: "Site API key not found" }); return value; }
async function summaries(database: Database, organizationId: string): Promise<SiteKeyInfo[]> {
  const keys = await database.select().from(siteApiKeys).where(eq(siteApiKeys.organizationId, organizationId)).orderBy(desc(siteApiKeys.createdAt), desc(siteApiKeys.id));
  if (!keys.length) return [];
  const grants = await database.select().from(siteApiKeyTables).where(inArray(siteApiKeyTables.keyId, keys.map(key => key.id))).orderBy(asc(siteApiKeyTables.tableId));
  return keys.map(key => ({ id: key.id, name: key.name, prefix: key.prefix, canRead: key.canRead, canCreate: key.canCreate,
    createdAt: key.createdAt.toISOString(), tableIds: grants.filter(grant => grant.keyId === key.id).map(grant => grant.tableId) }));
}
export async function listSiteKeys(deps: RuntimeDependencies, actor: Actor) {
  manager(actor); return { keys: await summaries(deps.database, actor.organizationId) };
}
async function grantTables(tx: Transaction, organizationId: string, tableIds: string[]) {
  const found = await tx.select({ id: tables.id }).from(tables).where(and(eq(tables.organizationId, organizationId), inArray(tables.id, tableIds))).orderBy(asc(tables.id)).for("share");
  if (found.length !== tableIds.length) throw new ServiceError(400, { message: "Choose tables from the current workspace" });
}
export async function createSiteKey(deps: RuntimeDependencies, actor: Actor, raw: unknown) {
  manager(actor); const input = siteKeyInput.parse(raw);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `tab_pub_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  const hash = await sha256(secret);
  return deps.database.transaction(async tx => {
    await grantTables(tx, actor.organizationId, input.tableIds);
    const [saved] = await tx.insert(siteApiKeys).values({ id: deps.uuid(), organizationId: actor.organizationId, createdBy: actor.userId,
      name: input.name, keyHash: hash, prefix: secret.slice(0, 16), canRead: input.canRead, canCreate: input.canCreate }).returning();
    await tx.insert(siteApiKeyTables).values(input.tableIds.map(tableId => ({ keyId: saved.id, tableId })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === saved.id)!, secret };
  });
}
export async function updateSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string, raw: unknown) {
  manager(actor); id(keyId); const input = siteKeyInput.parse(raw);
  return deps.database.transaction(async tx => {
    const [key] = await tx.select().from(siteApiKeys).where(and(eq(siteApiKeys.id, keyId), eq(siteApiKeys.organizationId, actor.organizationId))).for("update");
    if (!key) throw new ServiceError(404, { message: "Site API key not found" });
    await grantTables(tx, actor.organizationId, input.tableIds);
    await tx.update(siteApiKeys).set({ name: input.name, canRead: input.canRead, canCreate: input.canCreate }).where(eq(siteApiKeys.id, keyId));
    await tx.delete(siteApiKeyTables).where(eq(siteApiKeyTables.keyId, keyId));
    await tx.insert(siteApiKeyTables).values(input.tableIds.map(tableId => ({ keyId, tableId })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === keyId)! };
  });
}
export async function deleteSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string) {
  manager(actor); id(keyId);
  const [key] = await deps.database.delete(siteApiKeys).where(and(eq(siteApiKeys.id, keyId), eq(siteApiKeys.organizationId, actor.organizationId))).returning({ id: siteApiKeys.id });
  if (!key) throw new ServiceError(404, { message: "Site API key not found" });
  return key;
}
/** A publishable credential is a capability, never a human/agent Actor. */
export async function resolveSiteKey(database: Database, secret: string, lock = false): Promise<SitePrincipal> {
  if (!/^tab_pub_[A-Za-z0-9_-]{43}$/.test(secret)) throw new ServiceError(401, { message: "A valid publishable site API key is required" });
  const query = database.select().from(siteApiKeys).where(eq(siteApiKeys.keyHash, await sha256(secret)));
  const [key] = await (lock ? query.for("share") : query);
  if (!key) throw new ServiceError(401, { message: "Invalid site API key" });
  const grants = await database.select({ id: tables.id }).from(siteApiKeyTables).innerJoin(tables, eq(tables.id, siteApiKeyTables.tableId))
    .where(and(eq(siteApiKeyTables.keyId, key.id), eq(tables.organizationId, key.organizationId)));
  return { id: key.id, organizationId: key.organizationId, canRead: key.canRead, canCreate: key.canCreate, tableIds: new Set(grants.map(grant => grant.id)) };
}
export function requireSiteTable(principal: SitePrincipal, tableId: string, operation?: "read" | "create") {
  if (!principal.tableIds.has(tableId)) throw new ServiceError(404, { message: "Table not found" });
  if (operation === "read" && !principal.canRead || operation === "create" && !principal.canCreate)
    throw new ServiceError(403, { message: `This site API key does not allow ${operation}` });
}
