import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { sha256 } from "@tabdo/core/crypto";
import type { ApiKeyInfo, TablePermission } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Database, Transaction } from "../db/types.js";
import { userApiKeys, apiKeyTables, tables, workspaces } from "../db/schema.js";
import { ServiceError } from "../errors.js";

const permission = z.strictObject({ tableId: z.uuid(), canRead: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean() })
  .refine(p => p.canRead || p.canCreate || p.canUpdate || p.canDelete, "Choose at least one operation per table");
export const siteKeyInput = z.strictObject({ name: z.string().trim().min(1).max(100),
  permissions: z.array(permission).min(1).max(100).refine(all => new Set(all.map(p => p.tableId)).size === all.length),
});
export type Operation = "read" | "create" | "update" | "delete";
export type SitePrincipal = Readonly<{ id: string; organizationId: string; tableIds: ReadonlySet<string>; permissions: ReadonlyMap<string, TablePermission> }>;
export type SiteRateLimit = (input: { keyId: string; ip: string; kind: "read" | "create" }) => Promise<void>;
export const isApiKey = (secret: string) => /^tab_(?:pub_)?[A-Za-z0-9_-]{43}$/.test(secret);
export function requestApiKey(request: Request) {
  const bearer = request.headers.get("Authorization");
  if (bearer?.toLowerCase().startsWith("bearer tab_")) return bearer.slice(7).trim();
  return request.headers.get("X-Tabdo-Key") ?? "";
}
export function canAccess(principal: SitePrincipal, tableId: string, operation: Operation) {
  const grant = principal.permissions.get(tableId);
  return !!grant?.[({ read: "canRead", create: "canCreate", update: "canUpdate", delete: "canDelete" } as const)[operation]];
}
function manager(actor: Actor) {
  if (!actor.organizationId || actor.kind !== "human" || !["owner", "admin"].includes(actor.role))
    throw new ServiceError(403, { message: "Only workspace owners and admins can manage API keys" });
}
function id(value: string) { if (!z.uuid().safeParse(value).success) throw new ServiceError(404, { message: "API key not found" }); return value; }
async function summaries(database: Database, organizationId: string): Promise<ApiKeyInfo[]> {
  const keys = await database.select().from(userApiKeys).where(and(eq(userApiKeys.organizationId, organizationId), isNull(userApiKeys.revokedAt))).orderBy(desc(userApiKeys.createdAt), desc(userApiKeys.id));
  if (!keys.length) return [];
  const grants = await database.select().from(apiKeyTables).where(inArray(apiKeyTables.keyId, keys.map(key => key.id))).orderBy(asc(apiKeyTables.tableId));
  return keys.map(key => ({ id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt.toISOString(),
    permissions: grants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant) }));
}
export async function listSiteKeys(deps: RuntimeDependencies, actor: Actor) { manager(actor); return { keys: await summaries(deps.database, actor.organizationId), tables: await deps.database.select({ id: tables.id,
    name: tables.name, description: tables.description, icon: tables.icon, pinned: tables.pinned, createdAt: tables.createdAt, updatedAt: tables.updatedAt,
    workspaceId: tables.workspaceId, workspaceName: workspaces.name }).from(tables).innerJoin(workspaces, eq(workspaces.id, tables.workspaceId))
    .where(eq(tables.organizationId, actor.organizationId)).orderBy(asc(workspaces.createdAt), asc(tables.createdAt)) }; }
async function grantTables(tx: Transaction, organizationId: string, tableIds: string[]) {
  const found = await tx.select({ id: tables.id }).from(tables).where(and(eq(tables.organizationId, organizationId), inArray(tables.id, tableIds))).orderBy(asc(tables.id)).for("share");
  if (found.length !== tableIds.length) throw new ServiceError(400, { message: "Choose tables from the current workspace" });
}
export async function createSiteKey(deps: RuntimeDependencies, actor: Actor, raw: unknown) {
  manager(actor); const input = siteKeyInput.parse(raw);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `tab_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  const hash = await sha256(secret);
  return deps.database.transaction(async tx => {
    await grantTables(tx, actor.organizationId, input.permissions.map(p => p.tableId));
    const [saved] = await tx.insert(userApiKeys).values({ id: deps.uuid(), organizationId: actor.organizationId, userId: actor.userId,
      name: input.name, keyHash: hash, prefix: secret.slice(0, 12) }).returning();
    await tx.insert(apiKeyTables).values(input.permissions.map(grant => ({ keyId: saved.id, ...grant })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === saved.id)!, secret };
  });
}
export async function updateSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string, raw: unknown) {
  manager(actor); id(keyId); const input = siteKeyInput.parse(raw);
  return deps.database.transaction(async tx => {
    const [key] = await tx.select().from(userApiKeys).where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.organizationId, actor.organizationId), isNull(userApiKeys.revokedAt))).for("update");
    if (!key) throw new ServiceError(404, { message: "API key not found" });
    await grantTables(tx, actor.organizationId, input.permissions.map(p => p.tableId));
    await tx.update(userApiKeys).set({ name: input.name }).where(eq(userApiKeys.id, keyId));
    await tx.delete(apiKeyTables).where(eq(apiKeyTables.keyId, keyId));
    await tx.insert(apiKeyTables).values(input.permissions.map(grant => ({ keyId, ...grant })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === keyId)! };
  });
}
export async function deleteSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string) {
  manager(actor); id(keyId);
  const [key] = await deps.database.delete(userApiKeys).where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.organizationId, actor.organizationId))).returning({ id: userApiKeys.id });
  if (!key) throw new ServiceError(404, { message: "API key not found" }); return key;
}
export async function resolveSiteKey(database: Database, secret: string, lock = false): Promise<SitePrincipal> {
  if (!isApiKey(secret)) throw new ServiceError(401, { message: "A valid API key is required" });
  const query = database.select().from(userApiKeys).where(and(eq(userApiKeys.keyHash, await sha256(secret)), isNull(userApiKeys.revokedAt)));
  const [key] = await (lock ? query.for("share") : query);
  if (!key) throw new ServiceError(401, { message: "Invalid API key" });
  const grants = await database.select({ tableId: tables.id, canRead: apiKeyTables.canRead, canCreate: apiKeyTables.canCreate, canUpdate: apiKeyTables.canUpdate, canDelete: apiKeyTables.canDelete }).from(apiKeyTables).innerJoin(tables, eq(tables.id, apiKeyTables.tableId))
    .where(and(eq(apiKeyTables.keyId, key.id), eq(tables.organizationId, key.organizationId)));
  return { id: key.id, organizationId: key.organizationId, tableIds: new Set(grants.map(g => g.tableId)), permissions: new Map(grants.map(g => [g.tableId, g])) };
}
export function requireSiteTable(principal: SitePrincipal, tableId: string, operation?: Operation) {
  if (!principal.tableIds.has(tableId)) throw new ServiceError(404, { message: "Table not found" });
  if (operation && !canAccess(principal, tableId, operation)) throw new ServiceError(403, { message: `This API key does not allow ${operation} on this table` });
}
