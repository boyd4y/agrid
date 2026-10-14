import { and, eq, isNull } from "drizzle-orm";
import { ServiceError } from "../errors.js";
import type { IntegrationConnection, WebhookEndpoint } from "@tabdo/shared";
import type { Actor } from "../auth/actor.js";
import type { IntegrationDependencies } from "./dependencies.js";

import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { validUuid } from "./body.js";

export function canManageIntegrations(actor: Actor) { return actor.kind === "human" && ["owner", "admin"].includes(actor.role); }
export function receiveUrl(deps: Pick<IntegrationDependencies, "publicUrl">, endpoint: Pick<typeof webhookEndpoints.$inferSelect, "id" | "kind">) {
  let base: URL;
  try { base = new URL(deps.publicUrl); }
  catch { throw new ServiceError(503, { message: "Webhook 公网地址配置不正确" }); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new ServiceError(503, { message: "Webhook 公网地址配置不正确" });
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
export function publicEndpoint(deps: Pick<IntegrationDependencies, "publicUrl">, record: Pick<typeof webhookEndpoints.$inferSelect, keyof typeof endpointFields>): WebhookEndpoint {
  return { id: record.id, name: record.name, kind: record.kind, connectionId: record.connectionId, inboxIds: record.inboxIds, receiveUrl: receiveUrl(deps, record),
    enabled: record.enabled, state: record.state as WebhookEndpoint["state"], lastError: record.lastError, createdAt: record.createdAt.toISOString() };
}
export async function ownedConnection(deps: IntegrationDependencies, id: string, organizationId: string) {
  const [record] = await deps.database.select().from(integrationConnections).where(and(eq(integrationConnections.id, validUuid(id)), eq(integrationConnections.organizationId, organizationId), isNull(integrationConnections.deletedAt)));
  if (!record) throw new ServiceError(404, { message: "集成不存在" }); return record;
}
export async function ownedEndpoint(deps: IntegrationDependencies, id: string, organizationId: string) {
  const [record] = await deps.database.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, validUuid(id)), eq(webhookEndpoints.organizationId, organizationId), isNull(webhookEndpoints.deletedAt)));
  if (!record) throw new ServiceError(404, { message: "Webhook 不存在" }); return record;
}
