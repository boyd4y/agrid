import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { Webhook } from "svix";
import { getDatabase } from "@tabdo/backend/resources";

import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { agentMailInboxes, agentMailRequest, changeRemoteWebhook, connectionKey } from "../integrations/agentmail.js";
import { encryptSecret } from "../integrations/secrets.js";
import { integrationError, parseBody } from "../integrations/http.js";
import { canManageIntegrations, connectionFields, integrationActor, ownedConnection, publicConnection, publicEndpoint, receiveUrl } from "../integrations/management.js";

export const integrationsRoute = new Hono();
integrationsRoute.onError(integrationError);
const name = z.string().trim().min(1).max(100), apiKey = z.string().trim().min(1).max(4096);
integrationsRoute.get("/", async c => {
  const actor = await integrationActor(c);
  const records = await getDatabase().select(connectionFields).from(integrationConnections).where(and(eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt))).orderBy(desc(integrationConnections.createdAt));
  return c.json({ connections: records.map(publicConnection), canManage: canManageIntegrations(actor) });
});
integrationsRoute.post("/", async c => {
  const actor = await integrationActor(c, true);
  const body = await parseBody(c, z.strictObject({ provider: z.literal("agentmail"), name, apiKey }));
  const id = randomUUID();
  const encryptedCredential = encryptSecret(body.apiKey, { organizationId: actor.organizationId, id, purpose: "agentmail-key" });
  const [record] = await getDatabase().insert(integrationConnections).values({ id, organizationId: actor.organizationId, createdByUserId: actor.userId, provider: body.provider, name: body.name, encryptedCredential }).returning();
  return c.json({ connection: publicConnection(record) }, 201);
});
integrationsRoute.patch("/:id", async c => {
  const actor = await integrationActor(c, true), connection = await ownedConnection(c.req.param("id"), actor.organizationId);
  const body = await parseBody(c, z.strictObject({ name: name.optional(), apiKey: apiKey.optional(), enabled: z.boolean().optional() }).refine(value => Object.keys(value).length > 0));
  const encryptedCredential = body.apiKey === undefined ? connection.encryptedCredential : encryptSecret(body.apiKey, { organizationId: actor.organizationId, id: connection.id, purpose: "agentmail-key" });
  const remoteConnection = { ...connection, encryptedCredential };
  if (body.enabled === false) await getDatabase().update(integrationConnections).set({ enabled: false }).where(eq(integrationConnections.id, connection.id));
  if (body.enabled !== undefined) {
    const endpoints = await getDatabase().select().from(webhookEndpoints).where(and(eq(webhookEndpoints.connectionId, connection.id), isNull(webhookEndpoints.deletedAt)));
    try {
      for (const endpoint of endpoints) await changeRemoteWebhook(remoteConnection, endpoint, body.enabled && endpoint.enabled && endpoint.state === "active");
    } catch (error) {
      await getDatabase().update(integrationConnections).set({ state: "error", lastError: error instanceof HTTPException ? error.message : "AgentMail Webhook 更新失败", updatedAt: new Date() }).where(eq(integrationConnections.id, connection.id));
      throw error;
    }
  }
  const [record] = await getDatabase().update(integrationConnections).set({ ...(body.name === undefined ? {} : { name: body.name }), ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    ...(body.apiKey === undefined ? {} : { encryptedCredential, state: "unverified", lastError: null }), updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt))).returning();
  if (!record) throw new HTTPException(404, { message: "集成不存在" });
  return c.json({ connection: publicConnection(record) });
});
integrationsRoute.delete("/:id", async c => {
  const actor = await integrationActor(c, true), connection = await ownedConnection(c.req.param("id"), actor.organizationId);
  await getDatabase().update(integrationConnections).set({ enabled: false }).where(eq(integrationConnections.id, connection.id));
  const endpoints = await getDatabase().select().from(webhookEndpoints).where(and(eq(webhookEndpoints.connectionId, connection.id), isNull(webhookEndpoints.deletedAt)));
  try { for (const endpoint of endpoints) await changeRemoteWebhook(connection, endpoint, "delete"); }
  catch (error) {
    await getDatabase().update(integrationConnections).set({ state: "error", lastError: error instanceof HTTPException ? error.message : "AgentMail Webhook 删除失败", updatedAt: new Date() }).where(eq(integrationConnections.id, connection.id));
    throw error;
  }
  const record = await getDatabase().transaction(async tx => {
    const [record] = await tx.update(integrationConnections).set({ enabled: false, deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt))).returning();
    if (!record) throw new HTTPException(404, { message: "集成不存在" });
    await tx.update(webhookEndpoints).set({ enabled: false, deletedAt: new Date() }).where(eq(webhookEndpoints.connectionId, record.id));
    return record;
  });
  return c.json({ connection: publicConnection(record) });
});
integrationsRoute.post("/:id/test", async c => {
  const actor = await integrationActor(c, true), connection = await ownedConnection(c.req.param("id"), actor.organizationId);
  if (!connection.enabled) throw new HTTPException(400, { message: "请先启用集成" });
  let state = "connected", lastError: string | null = null;
  try { await agentMailInboxes(connectionKey(connection)); }
  catch (error) { state = "error"; lastError = error instanceof HTTPException ? error.message : "AgentMail 连接失败"; }
  await getDatabase().update(integrationConnections).set({ state, lastError, updatedAt: new Date() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.encryptedCredential, connection.encryptedCredential), isNull(integrationConnections.deletedAt)));
  return c.json({ connection: publicConnection(await ownedConnection(connection.id, actor.organizationId)), ok: state === "connected" });
});
integrationsRoute.get("/:id/inboxes", async c => {
  const actor = await integrationActor(c), connection = await ownedConnection(c.req.param("id"), actor.organizationId);
  if (!connection.enabled) throw new HTTPException(400, { message: "此集成已停用" });
  return c.json({ inboxes: await agentMailInboxes(connectionKey(connection)) });
});
integrationsRoute.post("/:id/webhooks", async c => {
  const actor = await integrationActor(c, true), connection = await ownedConnection(c.req.param("id"), actor.organizationId);
  if (!connection.enabled) throw new HTTPException(400, { message: "请先启用集成" });
  const body = await parseBody(c, z.strictObject({ inboxIds: z.array(z.string().trim().min(1).max(300)).min(1).max(10).refine(values => new Set(values).size === values.length) }));
  const key = connectionKey(connection);
  const inboxes = await agentMailInboxes(key);
  if (body.inboxIds.some(id => !inboxes.some(inbox => inbox.inboxId === id))) throw new HTTPException(400, { message: "请选择此连接可访问的收件箱" });
  const id = randomUUID(), endpointName = `${connection.name} · ${body.inboxIds.join(", ")}`;
  const [pending] = await getDatabase().insert(webhookEndpoints).values({ id, organizationId: actor.organizationId, createdByUserId: actor.userId, name: endpointName.slice(0, 300), kind: "agentmail", connectionId: connection.id, inboxIds: body.inboxIds, state: "pending" }).returning();
  let remoteId: string | undefined;
  try {
    const remote = await agentMailRequest(key, "/v0/webhooks", { method: "POST", body: { url: receiveUrl(pending), event_types: ["message.received"], inbox_ids: body.inboxIds, client_id: id } });
    if (typeof remote.webhook_id === "string" && remote.webhook_id && ![".", ".."].includes(remote.webhook_id)) remoteId = remote.webhook_id;
    const result = z.object({ webhook_id: z.string().min(1), secret: z.string().min(1) }).safeParse(remote);
    if (!result.success) throw new HTTPException(502, { message: "AgentMail Webhook 响应格式不正确" });
    remoteId = result.data.webhook_id;
    try { new Webhook(result.data.secret); }
    catch { throw new HTTPException(502, { message: "AgentMail Webhook 签名密钥格式不正确" }); }
    const encryptedSigningSecret = encryptSecret(result.data.secret, { organizationId: actor.organizationId, id, purpose: "agentmail-signing" });
    const endpoint = await getDatabase().transaction(async tx => {
      const [current] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, connection.id)).for("share");
      if (!current || !current.enabled || current.deletedAt || JSON.stringify(current.encryptedCredential) !== JSON.stringify(connection.encryptedCredential)) throw new HTTPException(409, { message: "连接配置已变化，请重试" });
      const [saved] = await tx.update(webhookEndpoints).set({ remoteWebhookId: remoteId, encryptedSigningSecret, state: "active", lastError: null }).where(and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt))).returning();
      if (!saved) throw new HTTPException(409, { message: "Webhook 已被删除" }); return saved;
    });
    return c.json({ endpoint: publicEndpoint(endpoint) }, 201);
  } catch (error) {
    if (remoteId) { try { await agentMailRequest(key, `/v0/webhooks/${encodeURIComponent(remoteId)}`, { method: "DELETE", allowNotFound: true }); } catch { /* The local endpoint remains unusable; never leak provider errors or keys. */ } }
    await getDatabase().update(webhookEndpoints).set({ state: "error", lastError: error instanceof HTTPException ? error.message : "Webhook 创建失败" }).where(eq(webhookEndpoints.id, id));
    throw error;
  }
});
