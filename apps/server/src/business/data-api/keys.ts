import { suspendKeySubscriptions, lockSubscriptionCalendarsForKey } from "../calendar/subscriptions.js";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { sha256 } from "@tabdo/core/crypto";
import { blogPermissionSchema, type BlogPermission, documentPermissionSchema, type DocumentPermission, schedulePermissionSchema, calendarPermissionSchema, type CalendarPermission, type ApiKeyInfo, type TablePermission } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Database, Transaction } from "../db/types.js";
import { userApiKeys, apiKeyTables, apiKeyCalendars, apiKeyDocuments, apiKeyBlogs, apiKeySchedules, automations, calendars, tables, workspaces } from "../db/schema.js";
import { ServiceError } from "../errors.js";

const permission = z.strictObject({ tableId: z.uuid(), canRead: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean() })
  .refine(p => p.canRead || p.canCreate || p.canUpdate || p.canDelete, "Choose at least one operation per table");
export const siteKeyInput = z.strictObject({ name: z.string().trim().min(1).max(100),
  permissions: z.array(permission).max(100).refine(all => new Set(all.map(p => p.tableId)).size === all.length),
  blogPermissions: z.array(blogPermissionSchema).max(100).refine(all => new Set(all.map(p => p.tableId)).size === all.length).default([]),
  documentPermissions: z.array(documentPermissionSchema).max(100).refine(all => new Set(all.map(p => p.tableId)).size === all.length).default([]),
  schedulePermissions: z.array(schedulePermissionSchema).max(100).refine(all => new Set(all.map(p => p.automationId)).size === all.length).default([]),
  calendarPermissions: z.array(calendarPermissionSchema).max(100).refine(all => new Set(all.map(p => p.calendarId)).size === all.length).default([]),
}).refine(input => input.permissions.length + input.calendarPermissions.length + input.schedulePermissions.length + input.documentPermissions.length + input.blogPermissions.length > 0, "Choose at least one grant");
export type Operation = "read" | "create" | "update" | "delete";
export type SitePrincipal = Readonly<{ blogPermissions: ReadonlyMap<string, BlogPermission>; id: string; userId?: string | null; organizationId: string; schedulePermissions?: ReadonlyMap<string, import("@tabdo/shared").SchedulePermission>; tableIds: ReadonlySet<string>; permissions: ReadonlyMap<string, TablePermission>; documentPermissions: ReadonlyMap<string, DocumentPermission>; calendarPermissions: ReadonlyMap<string, CalendarPermission> }>;
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
  const calendarGrants = await database.select().from(apiKeyCalendars).where(inArray(apiKeyCalendars.keyId, keys.map(key => key.id)));
  const documentGrants = await database.select().from(apiKeyDocuments).where(inArray(apiKeyDocuments.keyId, keys.map(key => key.id)));
  const blogGrants = await database.select().from(apiKeyBlogs).where(inArray(apiKeyBlogs.keyId, keys.map(key => key.id)));
  const scheduleGrants = await database.select().from(apiKeySchedules).where(inArray(apiKeySchedules.keyId, keys.map(key => key.id)));
  return keys.map(key => ({ id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt.toISOString(),
    blogPermissions: blogGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    schedulePermissions: scheduleGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    documentPermissions: documentGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    calendarPermissions: calendarGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    permissions: grants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant) }));
}
export async function listSiteKeys(deps: RuntimeDependencies, actor: Actor) { manager(actor); return { keys: await summaries(deps.database, actor.organizationId), tables: await deps.database.select({ id: tables.id,
    name: tables.name, description: tables.description, icon: tables.icon, pinned: tables.pinned, createdAt: tables.createdAt, updatedAt: tables.updatedAt,
    workspaceId: tables.workspaceId, workspaceName: workspaces.name }).from(tables).innerJoin(workspaces, eq(workspaces.id, tables.workspaceId))
    .where(eq(tables.organizationId, actor.organizationId)).orderBy(asc(workspaces.createdAt), asc(tables.createdAt)),
    schedules: await deps.database.select({ id: automations.id, name: automations.name, workspaceName: workspaces.name }).from(automations).innerJoin(workspaces, eq(workspaces.id, automations.workspaceId)).where(and(eq(automations.organizationId, actor.organizationId), isNull(automations.deletedAt), sql`${automations.source}->>'kind' = 'schedule'`)),
    calendars: await deps.database.select({ id: calendars.id, name: calendars.name, workspaceId: calendars.workspaceId, workspaceName: workspaces.name }).from(calendars).innerJoin(workspaces, eq(workspaces.id, calendars.workspaceId)).where(eq(calendars.organizationId, actor.organizationId)).orderBy(asc(workspaces.createdAt), asc(calendars.id)) }; }
async function grantTables(tx: Transaction, organizationId: string, tableIds: string[]) {
  if (!tableIds.length) return;
  const found = await tx.select({ id: tables.id }).from(tables).where(and(eq(tables.organizationId, organizationId), inArray(tables.id, tableIds))).orderBy(asc(tables.id)).for("share");
  if (found.length !== tableIds.length) throw new ServiceError(400, { message: "Choose tables from the current workspace" });
}
async function grantCalendars(tx: Transaction, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.organizationId, organizationId), inArray(calendars.id, ids))).orderBy(asc(calendars.id)).for("share");
  if (found.length !== ids.length) throw new ServiceError(400, { message: "Choose calendars from the current organization" });
}
async function grantSchedules(tx: Transaction, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.select({ id: automations.id }).from(automations).where(and(eq(automations.organizationId, organizationId), inArray(automations.id, ids), isNull(automations.deletedAt), sql`${automations.source}->>'kind' = 'schedule'`)).orderBy(asc(automations.id)).for("share");
  if (found.length !== ids.length) throw new ServiceError(400, { message: "Choose active scheduled rules from the current organization" });
}
export async function createSiteKey(deps: RuntimeDependencies, actor: Actor, raw: unknown) {
  manager(actor); const input = siteKeyInput.parse(raw);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `tab_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  const hash = await sha256(secret);
  return deps.database.transaction(async tx => {
    await grantSchedules(tx, actor.organizationId, input.schedulePermissions.map(p => p.automationId));
    await grantTables(tx, actor.organizationId, input.permissions.map(p => p.tableId));
    await grantCalendars(tx, actor.organizationId, input.calendarPermissions.map(p => p.calendarId));
    await grantTables(tx, actor.organizationId, input.documentPermissions.map(p => p.tableId));
    await grantTables(tx, actor.organizationId, input.blogPermissions.map(p => p.tableId));
    const [saved] = await tx.insert(userApiKeys).values({ id: deps.uuid(), organizationId: actor.organizationId, userId: actor.userId,
      name: input.name, keyHash: hash, prefix: secret.slice(0, 12) }).returning();
    if (input.permissions.length) await tx.insert(apiKeyTables).values(input.permissions.map(grant => ({ keyId: saved.id, ...grant })));
    if (input.schedulePermissions.length) await tx.insert(apiKeySchedules).values(input.schedulePermissions.map(grant => ({ keyId: saved.id, ...grant })));
    if (input.documentPermissions.length) await tx.insert(apiKeyDocuments).values(input.documentPermissions.map(grant => ({ keyId: saved.id, ...grant })));
    if (input.blogPermissions.length) await tx.insert(apiKeyBlogs).values(input.blogPermissions.map(grant => ({ keyId: saved.id, ...grant })));
    if (input.calendarPermissions.length) await tx.insert(apiKeyCalendars).values(input.calendarPermissions.map(grant => ({ keyId: saved.id, ...grant })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === saved.id)!, secret };
  });
}
export async function updateSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string, raw: unknown) {
  manager(actor); id(keyId); const input = siteKeyInput.parse(raw);
  return deps.database.transaction(async tx => {
    const [key] = await tx.select().from(userApiKeys).where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.organizationId, actor.organizationId), isNull(userApiKeys.revokedAt))).for("update");
    if (!key) throw new ServiceError(404, { message: "API key not found" });
    await lockSubscriptionCalendarsForKey(tx, actor.organizationId, keyId, input.calendarPermissions.map(p => p.calendarId));
    await grantSchedules(tx, actor.organizationId, input.schedulePermissions.map(p => p.automationId));
    await grantTables(tx, actor.organizationId, input.permissions.map(p => p.tableId));
    await grantCalendars(tx, actor.organizationId, input.calendarPermissions.map(p => p.calendarId));
    await grantTables(tx, actor.organizationId, input.documentPermissions.map(p => p.tableId));
    await grantTables(tx, actor.organizationId, input.blogPermissions.map(p => p.tableId));
    await tx.update(userApiKeys).set({ name: input.name }).where(eq(userApiKeys.id, keyId));
    await tx.delete(apiKeySchedules).where(eq(apiKeySchedules.keyId, keyId));
    if (input.schedulePermissions.length) await tx.insert(apiKeySchedules).values(input.schedulePermissions.map(grant => ({ keyId, ...grant })));
    await tx.delete(apiKeyTables).where(eq(apiKeyTables.keyId, keyId));
    if (input.permissions.length) await tx.insert(apiKeyTables).values(input.permissions.map(grant => ({ keyId, ...grant })));
    await tx.delete(apiKeyBlogs).where(eq(apiKeyBlogs.keyId, keyId));
    if (input.blogPermissions.length) await tx.insert(apiKeyBlogs).values(input.blogPermissions.map(grant => ({ keyId, ...grant })));
    await tx.delete(apiKeyDocuments).where(eq(apiKeyDocuments.keyId, keyId));
    if (input.documentPermissions.length) await tx.insert(apiKeyDocuments).values(input.documentPermissions.map(grant => ({ keyId, ...grant })));
    await suspendKeySubscriptions(deps, tx, keyId, input.calendarPermissions.filter(g => g.canRead && g.canSubscribe).map(g => g.calendarId));
    await tx.delete(apiKeyCalendars).where(eq(apiKeyCalendars.keyId, keyId));
    if (input.calendarPermissions.length) await tx.insert(apiKeyCalendars).values(input.calendarPermissions.map(grant => ({ keyId, ...grant })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === keyId)! };
  });
}
export async function deleteSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string) {
  manager(actor); id(keyId);
  return deps.database.transaction(async tx => {
    const [key] = await tx.select({ id: userApiKeys.id }).from(userApiKeys).where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.organizationId, actor.organizationId))).for("update");
    if (!key) throw new ServiceError(404, { message: "API key not found" });
    await suspendKeySubscriptions(deps, tx, keyId, []);
    await tx.delete(userApiKeys).where(eq(userApiKeys.id, keyId));
    return key;
  });
}
export async function resolveSiteKey(database: Database, secret: string, lock = false): Promise<SitePrincipal> {
  if (!isApiKey(secret)) throw new ServiceError(401, { message: "A valid API key is required" });
  const query = database.select().from(userApiKeys).where(and(eq(userApiKeys.keyHash, await sha256(secret)), isNull(userApiKeys.revokedAt)));
  const [key] = await (lock ? query.for("share") : query);
  if (!key) throw new ServiceError(401, { message: "Invalid API key" });
  const grants = await database.select({ tableId: tables.id, canRead: apiKeyTables.canRead, canCreate: apiKeyTables.canCreate, canUpdate: apiKeyTables.canUpdate, canDelete: apiKeyTables.canDelete }).from(apiKeyTables).innerJoin(tables, eq(tables.id, apiKeyTables.tableId))
    .where(and(eq(apiKeyTables.keyId, key.id), eq(tables.organizationId, key.organizationId)));
  const calendarGrants = await database.select({ calendarId: calendars.id, canRead: apiKeyCalendars.canRead, canReadAvailability: apiKeyCalendars.canReadAvailability, canCreate: apiKeyCalendars.canCreate, canUpdate: apiKeyCalendars.canUpdate, canCancel: apiKeyCalendars.canCancel, canManage: apiKeyCalendars.canManage, canTriggerAgent: apiKeyCalendars.canTriggerAgent, canSubscribe: apiKeyCalendars.canSubscribe, canReadDeliveries: apiKeyCalendars.canReadDeliveries, canManageSubscriptions: apiKeyCalendars.canManageSubscriptions }).from(apiKeyCalendars).innerJoin(calendars, eq(calendars.id, apiKeyCalendars.calendarId)).where(and(eq(apiKeyCalendars.keyId, key.id), eq(calendars.organizationId, key.organizationId)));
  const scheduleGrants = await database.select().from(apiKeySchedules).where(eq(apiKeySchedules.keyId, key.id));
  const documentGrants = await database.select({ tableId: apiKeyDocuments.tableId, canRead: apiKeyDocuments.canRead, canCreate: apiKeyDocuments.canCreate, canUpdate: apiKeyDocuments.canUpdate, canReadHistory: apiKeyDocuments.canReadHistory, canRestore: apiKeyDocuments.canRestore, canUpload: apiKeyDocuments.canUpload }).from(apiKeyDocuments).innerJoin(tables, eq(tables.id, apiKeyDocuments.tableId)).where(and(eq(apiKeyDocuments.keyId, key.id), eq(tables.organizationId, key.organizationId)));
  const blogGrants = await database.select().from(apiKeyBlogs).innerJoin(tables, eq(tables.id, apiKeyBlogs.tableId)).where(and(eq(apiKeyBlogs.keyId, key.id), eq(tables.organizationId, key.organizationId)));
  return { blogPermissions: new Map(blogGrants.map(g => [g.api_key_blogs.tableId, g.api_key_blogs])), documentPermissions: new Map(documentGrants.map(g => [g.tableId, g])), userId: key.userId, schedulePermissions: new Map(scheduleGrants.map(g => [g.automationId, g])), calendarPermissions: new Map(calendarGrants.map(g => [g.calendarId, g])), id: key.id, organizationId: key.organizationId, tableIds: new Set(grants.map(g => g.tableId)), permissions: new Map(grants.map(g => [g.tableId, g])) };
}
export function requireSiteTable(principal: SitePrincipal, tableId: string, operation?: Operation) {
  if (!principal.tableIds.has(tableId)) throw new ServiceError(404, { message: "Table not found" });
  if (operation && !canAccess(principal, tableId, operation)) throw new ServiceError(403, { message: `This API key does not allow ${operation} on this table` });
}
