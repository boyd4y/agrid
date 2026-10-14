import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { IntegrationConnection, WebhookEndpoint } from "@tabdo/shared";
import { resolveActor, type Actor } from "../auth/actor.js";
import { getDatabase } from "../resources/scope.js";

import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { validUuid } from "./http.js";

export function canManageIntegrations(actor: Actor) { return actor.kind === "human" && ["owner", "admin"].includes(actor.role); }
export async function integrationActor(c: Context, manage = false) {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) throw new HTTPException(401, { message: "请登录并选择工作区" });
  if (manage && !canManageIntegrations(actor)) throw new HTTPException(403, { message: "仅工作区 owner/admin 可管理集成" });
  c.header("Cache-Control", "private, no-store"); return actor;
}
export function receiveUrl(endpoint: Pick<typeof webhookEndpoints.$inferSelect, "id" | "kind">) {
  let base: URL;
  try { base = new URL(process.env.WEBHOOK_PUBLIC_URL || process.env.APP_URL || "http://localhost:5173"); }
  catch { throw new HTTPException(503, { message: "Webhook 公网地址配置不正确" }); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new HTTPException(503, { message: "Webhook 公网地址配置不正确" });
  return `${base.origin}${base.pathname.replace(/\/$/, "")}/api/webhooks/${endpoint.kind === "agentmail" ? "agentmail/" : ""}${endpoint.id}`;
}
export const connectionFields = { id: integrationConnections.id, provider: integrationConnections.provider, name: integrationConnections.name,
  enabled: integrationConnections.enabled, state: integrationConnections.state, lastError: integrationConnections.lastError, createdAt: integrationConnections.createdAt };
export const endpointFields = { id: webhookEndpoints.id, name: webhookEndpoints.name, kind: webhookEndpoints.kind, connectionId: webhookEndpoints.connectionId,
  inboxIds: webhookEndpoints.inboxIds, enabled: webhookEndpoints.enabled, state: webhookEndpoints.state, lastError: webhookEndpoints.lastError, createdAt: webhookEndpoints.createdAt };
export function publicConnection(record: Pick<typeof integrationConnections.$inferSelect, keyof typeof connectionFields>): IntegrationConnection {
  return { id: record.id, provider: record.provider, name: record.name, enabled: record.enabled,
    state: record.state as IntegrationConnection["state"], lastError: record.lastError, createdAt: record.createdAt.toISOString() };
}
export function publicEndpoint(record: Pick<typeof webhookEndpoints.$inferSelect, keyof typeof endpointFields>): WebhookEndpoint {
  return { id: record.id, name: record.name, kind: record.kind, connectionId: record.connectionId, inboxIds: record.inboxIds, receiveUrl: receiveUrl(record),
    enabled: record.enabled, state: record.state as WebhookEndpoint["state"], lastError: record.lastError, createdAt: record.createdAt.toISOString() };
}
export async function ownedConnection(id: string, organizationId: string) {
  const [record] = await getDatabase().select().from(integrationConnections).where(and(eq(integrationConnections.id, validUuid(id)), eq(integrationConnections.organizationId, organizationId), isNull(integrationConnections.deletedAt)));
  if (!record) throw new HTTPException(404, { message: "集成不存在" }); return record;
}
export async function ownedEndpoint(id: string, organizationId: string) {
  const [record] = await getDatabase().select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, validUuid(id)), eq(webhookEndpoints.organizationId, organizationId), isNull(webhookEndpoints.deletedAt)));
  if (!record) throw new HTTPException(404, { message: "Webhook 不存在" }); return record;
}
