import { suspendKeySubscriptions, lockSubscriptionCalendarsForKey } from "../calendar/subscriptions.js";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { sha256 } from "@tabdo/core/crypto";
import { schedulePermissionSchema, calendarPermissionSchema, type CalendarPermission, type ApiKeyInfo, type TablePermission, type AutomationPermission, type ApiKeyWorkspacePermission } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Database, Transaction } from "../db/types.js";
import { userApiKeys, apiKeyTables, apiKeyCalendars, apiKeySchedules, apiKeyAutomations, apiKeyWorkspaces, member, user, automations, calendars, tables, workspaces } from "../db/schema.js";
import { ServiceError } from "../errors.js";

const permission = z.strictObject({ tableId: z.uuid(), canRead: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean() })
  .refine(p => p.canRead || p.canCreate || p.canUpdate || p.canDelete, "Choose at least one operation per table");
const automationPermission = z.strictObject({ automationId: z.uuid(), canRead: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean().default(false) }).refine(p => p.canRead || p.canUpdate || p.canDelete);
const workspacePermission = z.strictObject({ workspaceId: z.uuid(), canCreateAutomations: z.boolean(), canCreateSchedules: z.boolean() }).refine(p => p.canCreateAutomations || p.canCreateSchedules);
export const siteKeyInput = z.strictObject({ name: z.string().trim().min(1).max(100),
  permissions: z.array(permission).max(100).refine(all => new Set(all.map(p => p.tableId)).size === all.length),
  automationPermissions: z.array(automationPermission).max(100).refine(all => new Set(all.map(p => p.automationId)).size === all.length).default([]),
  workspacePermissions: z.array(workspacePermission).max(100).refine(all => new Set(all.map(p => p.workspaceId)).size === all.length).default([]),
  schedulePermissions: z.array(schedulePermissionSchema).max(100).refine(all => new Set(all.map(p => p.automationId)).size === all.length).default([]),
  calendarPermissions: z.array(calendarPermissionSchema).max(100).refine(all => new Set(all.map(p => p.calendarId)).size === all.length).default([]),
}).refine(input => input.permissions.length + input.calendarPermissions.length + input.schedulePermissions.length + input.automationPermissions.length + input.workspacePermissions.length > 0, "Choose at least one grant");
export type Operation = "read" | "create" | "update" | "delete";
export type SitePrincipal = Readonly<{ id: string; userId?: string | null; organizationId: string; automationPermissions?: ReadonlyMap<string, AutomationPermission>; workspacePermissions?: ReadonlyMap<string, ApiKeyWorkspacePermission>; schedulePermissions?: ReadonlyMap<string, import("@tabdo/shared").SchedulePermission>; tableIds: ReadonlySet<string>; permissions: ReadonlyMap<string, TablePermission>; calendarPermissions: ReadonlyMap<string, CalendarPermission> }>;
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
    throw new ServiceError(403, { message: "Only organization owners and admins can manage API keys" });
}
function id(value: string) { if (!z.uuid().safeParse(value).success) throw new ServiceError(404, { message: "API key not found" }); return value; }
async function currentManager(database: Database, actor: Pick<Actor, "organizationId" | "userId">) {
  const [membership] = await database.select({ role: member.role, kind: user.kind }).from(member).innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, actor.organizationId), eq(member.userId, actor.userId))).for("share", { of: member });
  if (!membership || membership.kind !== "human" || !["owner", "admin"].includes(membership.role)) throw new ServiceError(403, { message: "Current organization management permission is required" });
}
async function summaries(database: Database, organizationId: string): Promise<ApiKeyInfo[]> {
  const keys = await database.select().from(userApiKeys).where(and(eq(userApiKeys.organizationId, organizationId), isNull(userApiKeys.revokedAt))).orderBy(desc(userApiKeys.createdAt), desc(userApiKeys.id));
  if (!keys.length) return [];
  const grants = await database.select().from(apiKeyTables).where(inArray(apiKeyTables.keyId, keys.map(key => key.id))).orderBy(asc(apiKeyTables.tableId));
  const calendarGrants = await database.select().from(apiKeyCalendars).where(inArray(apiKeyCalendars.keyId, keys.map(key => key.id)));
  const scheduleGrants = await database.select().from(apiKeySchedules).where(inArray(apiKeySchedules.keyId, keys.map(key => key.id)));
  const automationGrants = await database.select().from(apiKeyAutomations).where(inArray(apiKeyAutomations.keyId, keys.map(key => key.id)));
  const workspaceGrants = await database.select().from(apiKeyWorkspaces).where(inArray(apiKeyWorkspaces.keyId, keys.map(key => key.id)));
  return keys.map(key => ({ id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt.toISOString(),
    automationPermissions: automationGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    workspacePermissions: workspaceGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    schedulePermissions: scheduleGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    calendarPermissions: calendarGrants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant),
    permissions: grants.filter(g => g.keyId === key.id).map(({ keyId: _, ...grant }) => grant) }));
}
export async function listSiteKeys(deps: RuntimeDependencies, actor: Actor) { manager(actor); return deps.database.transaction(async tx => { await currentManager(tx, actor); return { workspaces: await tx.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(eq(workspaces.organizationId, actor.organizationId)).orderBy(asc(workspaces.createdAt), asc(workspaces.id)),
    automations: await tx.select({ id: automations.id, name: automations.name, workspaceId: automations.workspaceId, workspaceName: workspaces.name }).from(automations).innerJoin(workspaces, eq(workspaces.id, automations.workspaceId)).where(and(eq(automations.organizationId, actor.organizationId), isNull(automations.deletedAt), sql`${automations.source}->>'kind' NOT IN ('schedule', 'calendar')`)), keys: await summaries(tx, actor.organizationId), tables: await tx.select({ id: tables.id,
    name: tables.name, description: tables.description, icon: tables.icon, pinned: tables.pinned, createdAt: tables.createdAt, updatedAt: tables.updatedAt,
    workspaceId: tables.workspaceId, workspaceName: workspaces.name }).from(tables).innerJoin(workspaces, eq(workspaces.id, tables.workspaceId))
    .where(eq(tables.organizationId, actor.organizationId)).orderBy(asc(workspaces.createdAt), asc(tables.createdAt)),
    schedules: await tx.select({ id: automations.id, name: automations.name, workspaceId: automations.workspaceId, workspaceName: workspaces.name }).from(automations).innerJoin(workspaces, eq(workspaces.id, automations.workspaceId)).where(and(eq(automations.organizationId, actor.organizationId), isNull(automations.deletedAt), sql`${automations.source}->>'kind' = 'schedule'`)),
    calendars: await tx.select({ id: calendars.id, name: calendars.name, workspaceId: calendars.workspaceId, workspaceName: workspaces.name }).from(calendars).innerJoin(workspaces, eq(workspaces.id, calendars.workspaceId)).where(eq(calendars.organizationId, actor.organizationId)).orderBy(asc(workspaces.createdAt), asc(calendars.id)) }; }); }
async function grantTables(tx: Transaction, organizationId: string, tableIds: string[]) {
  if (!tableIds.length) return;
  const found = await tx.select({ id: tables.id }).from(tables).where(and(eq(tables.organizationId, organizationId), inArray(tables.id, tableIds))).orderBy(asc(tables.id)).for("share");
  if (found.length !== tableIds.length) throw new ServiceError(400, { message: "Choose tables from the current organization" });
}
async function grantCalendars(tx: Transaction, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.organizationId, organizationId), inArray(calendars.id, ids))).orderBy(asc(calendars.id)).for("share");
  if (found.length !== ids.length) throw new ServiceError(400, { message: "Choose calendars from the current organization" });
}
async function grantSchedules(tx: Transaction, organizationId: string, ids: string[], schedule = true) {
  if (!ids.length) return;
  const found = await tx.select({ id: automations.id }).from(automations).where(and(eq(automations.organizationId, organizationId), inArray(automations.id, ids), isNull(automations.deletedAt), (schedule ? sql`${automations.source}->>'kind' = 'schedule'` : sql`${automations.source}->>'kind' NOT IN ('schedule', 'calendar')`))).orderBy(asc(automations.id)).for("share");
  if (found.length !== ids.length) throw new ServiceError(400, { message: "Choose active scheduled rules from the current organization" });
}
async function grantWorkspaces(tx: Transaction, organizationId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.organizationId, organizationId), inArray(workspaces.id, ids))).orderBy(asc(workspaces.id)).for("share");
  if (found.length !== ids.length) throw new ServiceError(400, { message: "Choose workspaces from the current organization" });
}
async function validateNewGrants(tx: Transaction, actor: Actor, input: z.infer<typeof siteKeyInput>) {
  await currentManager(tx, actor);
  await grantSchedules(tx, actor.organizationId, input.automationPermissions.map(p => p.automationId), false);
  await grantWorkspaces(tx, actor.organizationId, input.workspacePermissions.map(p => p.workspaceId));
}
async function saveNewGrants(tx: Transaction, keyId: string, input: z.infer<typeof siteKeyInput>) {
  await tx.delete(apiKeyAutomations).where(eq(apiKeyAutomations.keyId, keyId));
  await tx.delete(apiKeyWorkspaces).where(eq(apiKeyWorkspaces.keyId, keyId));
  if (input.automationPermissions.length) await tx.insert(apiKeyAutomations).values(input.automationPermissions.map(grant => ({ keyId, ...grant })));
  if (input.workspacePermissions.length) await tx.insert(apiKeyWorkspaces).values(input.workspacePermissions.map(grant => ({ keyId, ...grant })));
}
export async function createSiteKey(deps: RuntimeDependencies, actor: Actor, raw: unknown) {
  manager(actor); const input = siteKeyInput.parse(raw);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `tab_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  const hash = await sha256(secret);
  return deps.database.transaction(async tx => {
    await validateNewGrants(tx, actor, input);
    await grantSchedules(tx, actor.organizationId, input.schedulePermissions.map(p => p.automationId));
    await grantTables(tx, actor.organizationId, input.permissions.map(p => p.tableId));
    await grantCalendars(tx, actor.organizationId, input.calendarPermissions.map(p => p.calendarId));
    const [saved] = await tx.insert(userApiKeys).values({ id: deps.uuid(), organizationId: actor.organizationId, userId: actor.userId,
      name: input.name, keyHash: hash, prefix: secret.slice(0, 12) }).returning();
    await saveNewGrants(tx, saved.id, input);
    if (input.permissions.length) await tx.insert(apiKeyTables).values(input.permissions.map(grant => ({ keyId: saved.id, ...grant })));
    if (input.schedulePermissions.length) await tx.insert(apiKeySchedules).values(input.schedulePermissions.map(grant => ({ keyId: saved.id, ...grant })));
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
    await validateNewGrants(tx, actor, input);
    await grantSchedules(tx, actor.organizationId, input.schedulePermissions.map(p => p.automationId));
    await grantTables(tx, actor.organizationId, input.permissions.map(p => p.tableId));
    await grantCalendars(tx, actor.organizationId, input.calendarPermissions.map(p => p.calendarId));
    await saveNewGrants(tx, keyId, input);
    await tx.update(userApiKeys).set({ name: input.name }).where(eq(userApiKeys.id, keyId));
    await tx.delete(apiKeySchedules).where(eq(apiKeySchedules.keyId, keyId));
    if (input.schedulePermissions.length) await tx.insert(apiKeySchedules).values(input.schedulePermissions.map(grant => ({ keyId, ...grant })));
    await tx.delete(apiKeyTables).where(eq(apiKeyTables.keyId, keyId));
    if (input.permissions.length) await tx.insert(apiKeyTables).values(input.permissions.map(grant => ({ keyId, ...grant })));
    await suspendKeySubscriptions(deps, tx, keyId, input.calendarPermissions.filter(g => g.canRead && g.canSubscribe).map(g => g.calendarId));
    await tx.delete(apiKeyCalendars).where(eq(apiKeyCalendars.keyId, keyId));
    if (input.calendarPermissions.length) await tx.insert(apiKeyCalendars).values(input.calendarPermissions.map(grant => ({ keyId, ...grant })));
    return { key: (await summaries(tx, actor.organizationId)).find(key => key.id === keyId)! };
  });
}
export async function deleteSiteKey(deps: RuntimeDependencies, actor: Actor, keyId: string) {
  manager(actor); id(keyId);
  return deps.database.transaction(async tx => {
    await currentManager(tx, actor);
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
  return resolveSiteKeyId(database, key.id, lock);
}
/** Internal durable binding for automation execution; never exposed as a credential. */
export async function resolveSiteKeyId(database: Database, keyId: string, lock = false): Promise<SitePrincipal> {
  const query = database.select().from(userApiKeys).where(and(eq(userApiKeys.id, keyId), isNull(userApiKeys.revokedAt)));
  const [key] = await (lock ? query.for("share") : query);
  if (!key) throw new ServiceError(401, { message: "Invalid API key" });
  if (!key.userId) throw new ServiceError(403, { message: "A current key manager is required" });
  await currentManager(database, { organizationId: key.organizationId, userId: key.userId });
  const grants = await database.select({ tableId: tables.id, canRead: apiKeyTables.canRead, canCreate: apiKeyTables.canCreate, canUpdate: apiKeyTables.canUpdate, canDelete: apiKeyTables.canDelete }).from(apiKeyTables).innerJoin(tables, eq(tables.id, apiKeyTables.tableId))
    .where(and(eq(apiKeyTables.keyId, key.id), eq(tables.organizationId, key.organizationId)));
  const calendarGrants = await database.select({ calendarId: calendars.id, canRead: apiKeyCalendars.canRead, canReadAvailability: apiKeyCalendars.canReadAvailability, canCreate: apiKeyCalendars.canCreate, canUpdate: apiKeyCalendars.canUpdate, canCancel: apiKeyCalendars.canCancel, canManage: apiKeyCalendars.canManage, canTriggerAgent: apiKeyCalendars.canTriggerAgent, canSubscribe: apiKeyCalendars.canSubscribe, canReadDeliveries: apiKeyCalendars.canReadDeliveries, canManageSubscriptions: apiKeyCalendars.canManageSubscriptions }).from(apiKeyCalendars).innerJoin(calendars, eq(calendars.id, apiKeyCalendars.calendarId)).where(and(eq(apiKeyCalendars.keyId, key.id), eq(calendars.organizationId, key.organizationId)));
  const scheduleGrants = await database.select({ grant: apiKeySchedules }).from(apiKeySchedules).innerJoin(automations, eq(automations.id, apiKeySchedules.automationId)).where(and(eq(apiKeySchedules.keyId, key.id), eq(automations.organizationId, key.organizationId), isNull(automations.deletedAt), sql`${automations.source}->>'kind' = 'schedule'`));
  const automationGrants = await database.select({ grant: apiKeyAutomations }).from(apiKeyAutomations).innerJoin(automations, eq(automations.id, apiKeyAutomations.automationId)).where(and(eq(apiKeyAutomations.keyId, key.id), eq(automations.organizationId, key.organizationId), isNull(automations.deletedAt), sql`${automations.source}->>'kind' NOT IN ('schedule', 'calendar')`));
  const workspaceGrants = await database.select({ grant: apiKeyWorkspaces }).from(apiKeyWorkspaces).innerJoin(workspaces, eq(workspaces.id, apiKeyWorkspaces.workspaceId)).where(and(eq(apiKeyWorkspaces.keyId, key.id), eq(workspaces.organizationId, key.organizationId)));
  return { userId: key.userId, automationPermissions: new Map(automationGrants.map(({ grant: g }) => [g.automationId, g])), workspacePermissions: new Map(workspaceGrants.map(({ grant: g }) => [g.workspaceId, g])), schedulePermissions: new Map(scheduleGrants.map(({ grant: g }) => [g.automationId, g])), calendarPermissions: new Map(calendarGrants.map(g => [g.calendarId, g])), id: key.id, organizationId: key.organizationId, tableIds: new Set(grants.map(g => g.tableId)), permissions: new Map(grants.map(g => [g.tableId, g])) };
}
export function requireSiteTable(principal: SitePrincipal, tableId: string, operation?: Operation) {
  if (!principal.tableIds.has(tableId)) throw new ServiceError(404, { message: "Table not found" });
  if (operation && !canAccess(principal, tableId, operation)) throw new ServiceError(403, { message: `This API key does not allow ${operation} on this table` });
}
