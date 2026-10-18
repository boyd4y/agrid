import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { Webhook } from "svix";
import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { agentMailInboxes, agentMailRequest, changeRemoteWebhook, connectionKey } from "../integrations/agentmail.js";
import { encryptSecret } from "../integrations/secrets.js";
import { parseBody } from "../integrations/body.js";
import { canManageIntegrations, connectionFields, ownedConnection, publicConnection, publicEndpoint, receiveUrl } from "../integrations/management.js";
import { ServiceError } from "../errors.js";
import type { IntegrationDependencies } from "../integrations/dependencies.js";
import type { Actor } from "../auth/actor.js";
import { sha256 } from "../auth/hash.js";
import { secretToken, verifyToken } from "../integrations/secrets.js";
const name = z.string().trim().min(1).max(100), apiKey = z.string().trim().min(1).max(4096);
const tokenHash = sha256;
function assertAgentMailConnection(connection: typeof integrationConnections.$inferSelect) {
  if (connection.provider !== "agentmail") throw new ServiceError(400, { message: "此连接不是 AgentMail 连接" });
}
export async function listConnections(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const records = await deps.database.select(connectionFields).from(integrationConnections).where(and(eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt))).orderBy(desc(integrationConnections.createdAt));
  return { connections: records.map(publicConnection), canManage: canManageIntegrations(actor) };
}
export async function createConnection(deps: IntegrationDependencies, actor: Actor, request: Request) {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const body = await parseBody(request, z.strictObject({ provider: z.literal("agentmail"), name, apiKey }));
  const id = deps.uuid();
  const encryptedCredential = await encryptSecret(deps, body.apiKey, { organizationId: actor.organizationId, id, purpose: "agentmail-key" });
  const [record] = await deps.database.insert(integrationConnections).values({ id, organizationId: actor.organizationId, createdByUserId: actor.userId, provider: body.provider, name: body.name, encryptedCredential }).returning();
  return { connection: publicConnection(record) };
}
export async function updateConnection(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const connection = await ownedConnection(deps, id, actor.organizationId);
  assertAgentMailConnection(connection);
  const body = await parseBody(request, z.strictObject({ name: name.optional(), apiKey: apiKey.optional(), enabled: z.boolean().optional() }).refine(value => Object.keys(value).length > 0));
  const encryptedCredential = body.apiKey === undefined ? connection.encryptedCredential : await encryptSecret(deps, body.apiKey, { organizationId: actor.organizationId, id: connection.id, purpose: "agentmail-key" });
  const remoteConnection = { ...connection, encryptedCredential };
  if (body.enabled === false)
    await deps.database.update(integrationConnections).set({ enabled: false }).where(eq(integrationConnections.id, connection.id));
  if (body.enabled !== undefined) {
    const endpoints = await deps.database.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.connectionId, connection.id), isNull(webhookEndpoints.deletedAt)));
    try {
      for (const endpoint of endpoints)
        await changeRemoteWebhook(deps, remoteConnection, endpoint, body.enabled && endpoint.enabled && endpoint.state === "active");
    }
    catch (error) {
      await deps.database.update(integrationConnections).set({ state: "error", lastError: error instanceof ServiceError ? error.message : "AgentMail Webhook 更新失败", updatedAt: deps.now() }).where(eq(integrationConnections.id, connection.id));
      throw error;
    }
  }
  const [record] = await deps.database.update(integrationConnections).set({ ...(body.name === undefined ? {} : { name: body.name }), ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
    ...(body.apiKey === undefined ? {} : { encryptedCredential, state: "unverified", lastError: null }), updatedAt: deps.now() })
    .where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt))).returning();
  if (!record)
    throw new ServiceError(404, { message: "集成不存在" });
  return { connection: publicConnection(record) };
}
export async function deleteConnection(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const connection = await ownedConnection(deps, id, actor.organizationId);
  assertAgentMailConnection(connection);
  await deps.database.update(integrationConnections).set({ enabled: false }).where(eq(integrationConnections.id, connection.id));
  const endpoints = await deps.database.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.connectionId, connection.id), isNull(webhookEndpoints.deletedAt)));
  try {
    for (const endpoint of endpoints)
      await changeRemoteWebhook(deps, connection, endpoint, "delete");
  }
  catch (error) {
    await deps.database.update(integrationConnections).set({ state: "error", lastError: error instanceof ServiceError ? error.message : "AgentMail Webhook 删除失败", updatedAt: deps.now() }).where(eq(integrationConnections.id, connection.id));
    throw error;
  }
  const record = await deps.database.transaction(async (tx) => {
    const [record] = await tx.update(integrationConnections).set({ enabled: false, deletedAt: deps.now(), updatedAt: deps.now() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.organizationId, actor.organizationId), isNull(integrationConnections.deletedAt))).returning();
    if (!record)
      throw new ServiceError(404, { message: "集成不存在" });
    await tx.update(webhookEndpoints).set({ enabled: false, deletedAt: deps.now() }).where(eq(webhookEndpoints.connectionId, record.id));
    return record;
  });
  return { connection: publicConnection(record) };
}
export async function testConnection(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const connection = await ownedConnection(deps, id, actor.organizationId);
  assertAgentMailConnection(connection);
  if (!connection.enabled)
    throw new ServiceError(400, { message: "请先启用集成" });
  let state = "connected", lastError: string | null = null;
  try {
    await agentMailInboxes(deps, await connectionKey(deps, connection));
  }
  catch (error) {
    state = "error";
    lastError = error instanceof ServiceError ? error.message : "AgentMail 连接失败";
  }
  await deps.database.update(integrationConnections).set({ state, lastError, updatedAt: deps.now() }).where(and(eq(integrationConnections.id, connection.id), eq(integrationConnections.encryptedCredential, connection.encryptedCredential), isNull(integrationConnections.deletedAt)));
  return { connection: publicConnection(await ownedConnection(deps, connection.id, actor.organizationId)), ok: state === "connected" };
}
export async function listInboxes(deps: IntegrationDependencies, actor: Actor, request: Request, id: string = "") {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const connection = await ownedConnection(deps, id, actor.organizationId);
  assertAgentMailConnection(connection);
  if (!connection.enabled)
    throw new ServiceError(400, { message: "此集成已停用" });
  return { inboxes: await agentMailInboxes(deps, await connectionKey(deps, connection)) };
}
export async function registerWebhook(deps: IntegrationDependencies, actor: Actor, request: Request, connectionId: string) {
  const header = (name: string) => request.headers.get(name) ?? undefined;
  const connection = await ownedConnection(deps, connectionId, actor.organizationId);
  assertAgentMailConnection(connection);
  if (!connection.enabled)
    throw new ServiceError(400, { message: "请先启用集成" });
  const body = await parseBody(request, z.strictObject({ inboxIds: z.array(z.string().trim().min(1).max(300)).min(1).max(10).refine(values => new Set(values).size === values.length) }));
  const key = await connectionKey(deps, connection);
  const inboxes = await agentMailInboxes(deps, key);
  if (body.inboxIds.some(id => !inboxes.some(inbox => inbox.inboxId === id)))
    throw new ServiceError(400, { message: "请选择此连接可访问的收件箱" });
  const id = deps.uuid(), endpointName = `${connection.name} · ${body.inboxIds.join(", ")}`;
  const [pending] = await deps.database.insert(webhookEndpoints).values({ id, organizationId: actor.organizationId, createdByUserId: actor.userId, name: endpointName.slice(0, 300), kind: "agentmail", connectionId: connection.id, inboxIds: body.inboxIds, state: "pending" }).returning();
  let remoteId: string | undefined;
  try {
    const remote = await agentMailRequest(deps, key, "/v0/webhooks", { method: "POST", body: { url: receiveUrl(deps, pending), event_types: ["message.received"], inbox_ids: body.inboxIds, client_id: id } });
    if (typeof remote.webhook_id === "string" && remote.webhook_id && ![".", ".."].includes(remote.webhook_id))
      remoteId = remote.webhook_id;
    const result = z.object({ webhook_id: z.string().min(1), secret: z.string().min(1) }).safeParse(remote);
    if (!result.success)
      throw new ServiceError(502, { message: "AgentMail Webhook 响应格式不正确" });
    remoteId = result.data.webhook_id;
    try {
      new Webhook(result.data.secret);
    }
    catch {
      throw new ServiceError(502, { message: "AgentMail Webhook 签名密钥格式不正确" });
    }
    const encryptedSigningSecret = await encryptSecret(deps, result.data.secret, { organizationId: actor.organizationId, id, purpose: "agentmail-signing" });
    const endpoint = await deps.database.transaction(async (tx) => {
      const [current] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, connection.id)).for("share");
      if (!current || !current.enabled || current.deletedAt || JSON.stringify(current.encryptedCredential) !== JSON.stringify(connection.encryptedCredential))
        throw new ServiceError(409, { message: "连接配置已变化，请重试" });
      const [saved] = await tx.update(webhookEndpoints).set({ remoteWebhookId: remoteId, encryptedSigningSecret, state: "active", lastError: null }).where(and(eq(webhookEndpoints.id, id), isNull(webhookEndpoints.deletedAt))).returning();
      if (!saved)
        throw new ServiceError(409, { message: "Webhook 已被删除" });
      return saved;
    });
    return { endpoint: publicEndpoint(deps, endpoint) };
  }
  catch (error) {
    if (remoteId) {
      try {
        await agentMailRequest(deps, key, `/v0/webhooks/${encodeURIComponent(remoteId)}`, { method: "DELETE", allowNotFound: true });
      }
      catch { /* The local endpoint remains unusable; never leak provider errors or keys. */ }
    }
    await deps.database.update(webhookEndpoints).set({ state: "error", lastError: error instanceof ServiceError ? error.message : "Webhook 创建失败" }).where(eq(webhookEndpoints.id, id));
    throw error;
  }
}
