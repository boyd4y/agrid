import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { Webhook } from "svix";
import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { canManageIntegrations, endpointFields, ownedEndpoint, publicEndpoint } from "../integrations/management.js";
import { boundedBody, jsonObject, jsonValue, parseBody, validUuid, webhookBodyLimit } from "../integrations/body.js";
import { decryptSecret } from "../integrations/secrets.js";
import { changeRemoteWebhook, normalizeAgentMailMessage } from "../integrations/agentmail.js";
import { persistDelivery } from "../integrations/deliveries.js";
import { ServiceError } from "../errors.js";
import type { IntegrationDependencies } from "../integrations/dependencies.js";
import type { Actor } from "../auth/actor.js";
import { sha256 } from "../auth/hash.js";
import { secretToken, verifyToken } from "../integrations/secrets.js";
const name = z.string().trim().min(1).max(100), apiKey = z.string().trim().min(1).max(4096);
const tokenHash = sha256;
async function activeEndpoint(deps: IntegrationDependencies, id: string, kind: "webhook" | "agentmail") {
  const [endpoint] = await deps.database.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, validUuid(id)), eq(webhookEndpoints.kind, kind), isNull(webhookEndpoints.deletedAt)));
  if (!endpoint)
    throw new ServiceError(404, { message: "Webhook 不存在" });
  if (!endpoint.enabled)
    throw new ServiceError(410, { message: "此 Webhook 已停用" });
  if (endpoint.state !== "active")
    throw new ServiceError(503, { message: "Webhook 尚未就绪" });
  return endpoint;
}
export async function listEndpoints(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const records = await deps.database.select(endpointFields).from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, actor.organizationId), isNull(webhookEndpoints.deletedAt))).orderBy(desc(webhookEndpoints.createdAt));
  return { endpoints: records.map(record => publicEndpoint(deps, record)), canManage: canManageIntegrations(actor) };
}
export async function createEndpoint(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const body = await parseBody(request, z.strictObject({ name }));
  const token = secretToken("hook_");
  const [record] = await deps.database.insert(webhookEndpoints).values({ organizationId: actor.organizationId, createdByUserId: actor.userId, name: body.name, kind: "webhook", tokenHash: await tokenHash(token), state: "active" }).returning();
  return { endpoint: publicEndpoint(deps, record), token };
}
export async function updateEndpoint(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const record = await ownedEndpoint(deps, id, actor.organizationId);
  const body = await parseBody(request, z.strictObject({ name: name.optional(), enabled: z.boolean().optional() }).refine(value => Object.keys(value).length > 0));
  if (record.kind === "agentmail" && body.enabled !== undefined) {
    if (!record.remoteWebhookId || !record.encryptedSigningSecret)
      throw new ServiceError(400, { message: "此 Webhook 注册未完成，请重新注册" });
    if (!body.enabled)
      await deps.database.update(webhookEndpoints).set({ enabled: false }).where(eq(webhookEndpoints.id, record.id));
    const [connection] = await deps.database.select().from(integrationConnections).where(and(eq(integrationConnections.id, record.connectionId!), eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt)));
    try {
      if (!connection || (body.enabled && !connection.enabled))
        throw new ServiceError(400, { message: "请先启用 AgentMail 连接" });
      await changeRemoteWebhook(deps, connection, record, body.enabled);
    }
    catch (error) {
      await deps.database.update(webhookEndpoints).set({ state: "error", lastError: error instanceof ServiceError ? error.message : "AgentMail Webhook 更新失败" }).where(eq(webhookEndpoints.id, record.id));
      throw error;
    }
  }
  const [saved] = await deps.database.update(webhookEndpoints).set({ ...body, ...(record.kind === "agentmail" && body.enabled !== undefined ? { state: "active", lastError: null } : {}) }).where(and(eq(webhookEndpoints.id, record.id), isNull(webhookEndpoints.deletedAt))).returning();
  if (!saved)
    throw new ServiceError(404, { message: "Webhook 不存在" });
  return { endpoint: publicEndpoint(deps, saved) };
}
export async function deleteEndpoint(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const record = await ownedEndpoint(deps, id, actor.organizationId);
  // Revoke locally first. If remote removal fails, retain a visible disabled
  // endpoint with its error so the user can retry instead of losing the handle.
  await deps.database.update(webhookEndpoints).set({ enabled: false, tokenHash: null }).where(eq(webhookEndpoints.id, record.id));
  if (record.kind === "agentmail" && record.remoteWebhookId && record.connectionId) {
    const [connection] = await deps.database.select().from(integrationConnections).where(and(eq(integrationConnections.id, record.connectionId), eq(integrationConnections.organizationId, actor.organizationId)));
    try {
      if (!connection)
        throw new ServiceError(503, { message: "无法读取 AgentMail 连接配置" });
      await changeRemoteWebhook(deps, connection, record, "delete");
    }
    catch (error) {
      await deps.database.update(webhookEndpoints).set({ state: "error", lastError: error instanceof ServiceError ? error.message : "AgentMail Webhook 删除失败" }).where(eq(webhookEndpoints.id, record.id));
      throw error;
    }
  }
  const [saved] = await deps.database.update(webhookEndpoints).set({ deletedAt: deps.now() }).where(and(eq(webhookEndpoints.id, record.id), isNull(webhookEndpoints.deletedAt))).returning();
  if (!saved)
    throw new ServiceError(404, { message: "Webhook 不存在" });
  return { endpoint: publicEndpoint(deps, saved) };
}
export async function receiveWebhook(deps: IntegrationDependencies, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const endpoint = await activeEndpoint(deps, id, "webhook");
  const rawToken = header("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1] ?? "";
  if (!await verifyToken(rawToken, endpoint.tokenHash))
    throw new ServiceError(401, { message: "Webhook 认证失败" });
  const key = header("idempotency-key");
  if (key !== undefined && (!key.trim() || key.length > 300))
    throw new ServiceError(400, { message: "Idempotency-Key 不正确" });
  const payload = jsonValue(await boundedBody(request, webhookBodyLimit(deps.bodyLimit)));
  const result = await persistDelivery(deps, endpoint, { dedupeKey: key?.trim() ?? deps.uuid(), payload: { payload }, event: { source: { kind: "webhook", endpointId: endpoint.id }, type: "webhook_received", occurredAt: deps.now().toISOString(), data: { payload } } });
  return { received: true, duplicate: result.duplicate };
}
export async function receiveAgentMail(deps: IntegrationDependencies, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const endpoint = await activeEndpoint(deps, id, "agentmail");
  if (!endpoint.connectionId || !endpoint.encryptedSigningSecret)
    throw new ServiceError(503, { message: "Webhook 尚未就绪" });
  const [connection] = await deps.database.select().from(integrationConnections).where(and(eq(integrationConnections.id, endpoint.connectionId), eq(integrationConnections.organizationId, endpoint.organizationId), eq(integrationConnections.enabled, true), isNull(integrationConnections.deletedAt)));
  if (!connection)
    throw new ServiceError(410, { message: "此连接已停用" });
  const body = await boundedBody(request, webhookBodyLimit(deps.bodyLimit));
  const secret = await decryptSecret(deps, endpoint.encryptedSigningSecret, { organizationId: endpoint.organizationId, id: endpoint.id, purpose: "agentmail-signing" });
  const deliveryId = header("svix-id") ?? "";
  if (!deliveryId || deliveryId.length > 300)
    throw new ServiceError(401, { message: "Webhook 签名无效" });
  try {
    new Webhook(secret).verify(new TextDecoder().decode(body), { "svix-id": deliveryId, "svix-timestamp": header("svix-timestamp") ?? "", "svix-signature": header("svix-signature") ?? "" });
  }
  catch {
    throw new ServiceError(401, { message: "Webhook 签名无效" });
  }
  const payload = jsonObject(body);
  if (payload.event_type !== "message.received") {
    const result = await persistDelivery(deps, endpoint, { dedupeKey: deliveryId, payload: { eventType: typeof payload.event_type === "string" ? payload.event_type : "unknown" } });
    return { received: true, duplicate: result.duplicate };
  }
  const message = normalizeAgentMailMessage(payload.message, deps.now().toISOString());
  if (!endpoint.inboxIds.includes(message.inboxId as string))
    throw new ServiceError(403, { message: "邮件不属于此 Webhook 的订阅收件箱" });
  const data = { message };
  const logicalKey = JSON.stringify(["message.received", message.inboxId, message.messageId]);
  const result = await persistDelivery(deps, endpoint, { dedupeKey: deliveryId, logicalKey, payload: data,
    event: { source: { kind: "agentmail", connectionId: endpoint.connectionId, inboxId: message.inboxId as string }, type: "message_received", occurredAt: message.receivedAt as string, data } });
  return { received: true, duplicate: result.duplicate };
}
