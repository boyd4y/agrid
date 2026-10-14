import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { Webhook } from "svix";
import { getDatabase } from "../resources/scope.js";

import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { integrationActor, canManageIntegrations, endpointFields, ownedEndpoint, publicEndpoint } from "../integrations/management.js";
import { boundedBody, integrationError, jsonObject, jsonValue, parseBody, validUuid, webhookBodyLimit } from "../integrations/http.js";
import { decryptSecret } from "../integrations/secrets.js";
import { changeRemoteWebhook, normalizeAgentMailMessage } from "../integrations/agentmail.js";
import { persistDelivery } from "../integrations/deliveries.js";

export const webhookEndpointsRoute = new Hono();
export const webhooksRoute = new Hono();
webhookEndpointsRoute.onError(integrationError);
webhooksRoute.onError(integrationError);
const name = z.string().trim().min(1).max(100);
const tokenHash = (raw: string) => createHash("sha256").update(raw).digest("hex");
webhookEndpointsRoute.get("/", async c => {
  const actor = await integrationActor(c);
  const records = await getDatabase().select(endpointFields).from(webhookEndpoints).where(and(eq(webhookEndpoints.organizationId, actor.organizationId), isNull(webhookEndpoints.deletedAt))).orderBy(desc(webhookEndpoints.createdAt));
  return c.json({ endpoints: records.map(publicEndpoint), canManage: canManageIntegrations(actor) });
});
webhookEndpointsRoute.post("/", async c => {
  const actor = await integrationActor(c, true), body = await parseBody(c, z.strictObject({ name }));
  const token = `hook_${randomBytes(32).toString("base64url")}`;
  const [record] = await getDatabase().insert(webhookEndpoints).values({ organizationId: actor.organizationId, createdByUserId: actor.userId, name: body.name, kind: "webhook", tokenHash: tokenHash(token), state: "active" }).returning();
  return c.json({ endpoint: publicEndpoint(record), token }, 201);
});
webhookEndpointsRoute.patch("/:id", async c => {
  const actor = await integrationActor(c, true), record = await ownedEndpoint(c.req.param("id"), actor.organizationId);
  const body = await parseBody(c, z.strictObject({ name: name.optional(), enabled: z.boolean().optional() }).refine(value => Object.keys(value).length > 0));
  if (record.kind === "agentmail" && body.enabled !== undefined) {
    if (!record.remoteWebhookId || !record.encryptedSigningSecret) throw new HTTPException(400, { message: "此 Webhook 注册未完成，请重新注册" });
    if (!body.enabled) await getDatabase().update(webhookEndpoints).set({ enabled: false }).where(eq(webhookEndpoints.id, record.id));
    const [connection] = await getDatabase().select().from(integrationConnections).where(and(eq(integrationConnections.id, record.connectionId!), eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt)));
    try {
      if (!connection || (body.enabled && !connection.enabled)) throw new HTTPException(400, { message: "请先启用 AgentMail 连接" });
      await changeRemoteWebhook(connection, record, body.enabled);
    } catch (error) {
      await getDatabase().update(webhookEndpoints).set({ state: "error", lastError: error instanceof HTTPException ? error.message : "AgentMail Webhook 更新失败" }).where(eq(webhookEndpoints.id, record.id));
      throw error;
    }
  }
  const [saved] = await getDatabase().update(webhookEndpoints).set({ ...body, ...(record.kind === "agentmail" && body.enabled !== undefined ? { state: "active", lastError: null } : {}) }).where(and(eq(webhookEndpoints.id, record.id), isNull(webhookEndpoints.deletedAt))).returning();
  if (!saved) throw new HTTPException(404, { message: "Webhook 不存在" }); return c.json({ endpoint: publicEndpoint(saved) });
});
webhookEndpointsRoute.delete("/:id", async c => {
  const actor = await integrationActor(c, true), record = await ownedEndpoint(c.req.param("id"), actor.organizationId);
  // Revoke locally first. If remote removal fails, retain a visible disabled
  // endpoint with its error so the user can retry instead of losing the handle.
  await getDatabase().update(webhookEndpoints).set({ enabled: false, tokenHash: null }).where(eq(webhookEndpoints.id, record.id));
  if (record.kind === "agentmail" && record.remoteWebhookId && record.connectionId) {
    const [connection] = await getDatabase().select().from(integrationConnections).where(and(eq(integrationConnections.id, record.connectionId), eq(integrationConnections.organizationId, actor.organizationId)));
    try {
      if (!connection) throw new HTTPException(503, { message: "无法读取 AgentMail 连接配置" });
      await changeRemoteWebhook(connection, record, "delete");
    } catch (error) {
      await getDatabase().update(webhookEndpoints).set({ state: "error", lastError: error instanceof HTTPException ? error.message : "AgentMail Webhook 删除失败" }).where(eq(webhookEndpoints.id, record.id));
      throw error;
    }
  }
  const [saved] = await getDatabase().update(webhookEndpoints).set({ deletedAt: new Date() }).where(and(eq(webhookEndpoints.id, record.id), isNull(webhookEndpoints.deletedAt))).returning();
  if (!saved) throw new HTTPException(404, { message: "Webhook 不存在" }); return c.json({ endpoint: publicEndpoint(saved) });
});
async function activeEndpoint(id: string, kind: "webhook" | "agentmail") {
  const [endpoint] = await getDatabase().select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, validUuid(id)), eq(webhookEndpoints.kind, kind), isNull(webhookEndpoints.deletedAt)));
  if (!endpoint) throw new HTTPException(404, { message: "Webhook 不存在" });
  if (!endpoint.enabled) throw new HTTPException(410, { message: "此 Webhook 已停用" });
  if (endpoint.state !== "active") throw new HTTPException(503, { message: "Webhook 尚未就绪" }); return endpoint;
}
webhooksRoute.post("/:id", async c => {
  const endpoint = await activeEndpoint(c.req.param("id"), "webhook");
  const rawToken = c.req.header("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1] ?? "";
  const actual = Buffer.from(tokenHash(rawToken), "hex"), expected = Buffer.from(endpoint.tokenHash ?? "", "hex");
  if (!rawToken || expected.length !== actual.length || !timingSafeEqual(actual, expected)) throw new HTTPException(401, { message: "Webhook 认证失败" });
  const key = c.req.header("idempotency-key");
  if (key !== undefined && (!key.trim() || key.length > 300)) throw new HTTPException(400, { message: "Idempotency-Key 不正确" });
  const payload = jsonValue(await boundedBody(c.req.raw, webhookBodyLimit()));
  const result = await persistDelivery(endpoint, { dedupeKey: key?.trim() ?? randomUUID(), payload: { payload }, event: { source: { kind: "webhook", endpointId: endpoint.id }, type: "webhook_received", occurredAt: new Date().toISOString(), data: { payload } } });
  return c.json({ received: true, duplicate: result.duplicate });
});
webhooksRoute.post("/agentmail/:id", async c => {
  const endpoint = await activeEndpoint(c.req.param("id"), "agentmail");
  if (!endpoint.connectionId || !endpoint.encryptedSigningSecret) throw new HTTPException(503, { message: "Webhook 尚未就绪" });
  const [connection] = await getDatabase().select().from(integrationConnections).where(and(eq(integrationConnections.id, endpoint.connectionId), eq(integrationConnections.organizationId, endpoint.organizationId), eq(integrationConnections.enabled, true), isNull(integrationConnections.deletedAt)));
  if (!connection) throw new HTTPException(410, { message: "此连接已停用" });
  const body = await boundedBody(c.req.raw, webhookBodyLimit());
  const secret = decryptSecret(endpoint.encryptedSigningSecret, { organizationId: endpoint.organizationId, id: endpoint.id, purpose: "agentmail-signing" });
  const deliveryId = c.req.header("svix-id") ?? "";
  if (!deliveryId || deliveryId.length > 300) throw new HTTPException(401, { message: "Webhook 签名无效" });
  try { new Webhook(secret).verify(body, { "svix-id": deliveryId, "svix-timestamp": c.req.header("svix-timestamp") ?? "", "svix-signature": c.req.header("svix-signature") ?? "" }); }
  catch { throw new HTTPException(401, { message: "Webhook 签名无效" }); }
  const payload = jsonObject(body);
  if (payload.event_type !== "message.received") {
    const result = await persistDelivery(endpoint, { dedupeKey: deliveryId, payload: { eventType: typeof payload.event_type === "string" ? payload.event_type : "unknown" } });
    return c.json({ received: true, duplicate: result.duplicate });
  }
  const message = normalizeAgentMailMessage(payload.message);
  if (!endpoint.inboxIds.includes(message.inboxId as string)) throw new HTTPException(403, { message: "邮件不属于此 Webhook 的订阅收件箱" });
  const data = { message };
  const logicalKey = JSON.stringify(["message.received", message.inboxId, message.messageId]);
  const result = await persistDelivery(endpoint, { dedupeKey: deliveryId, logicalKey, payload: data,
    event: { source: { kind: "agentmail", connectionId: endpoint.connectionId, inboxId: message.inboxId as string }, type: "message_received", occurredAt: message.receivedAt as string, data } });
  return c.json({ received: true, duplicate: result.duplicate });
});
