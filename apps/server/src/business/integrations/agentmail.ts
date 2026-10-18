import { and, eq, isNull } from "drizzle-orm";
import { ServiceError } from "../errors.js";
import { z } from "zod";
import { sendAgentMailMessageSchema, replyAgentMailMessageSchema, type IntegrationInbox, type SendAgentMailMessageInput, type ReplyAgentMailMessageInput } from "@tabdo/shared";
import type { ExternalAutomationEvent } from "../automation/events.js";
import type { IntegrationDependencies, IntegrationCapabilities } from "./dependencies.js";
type ProviderDependencies = Pick<IntegrationCapabilities, "fetch">;
type CredentialDependencies = Pick<IntegrationCapabilities, "encryptionKey">;

import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { decryptSecret } from "./secrets.js";
import { boundedBody, jsonObject } from "./body.js";

const origin = "https://api.agentmail.to";
export async function agentMailRequest(deps: ProviderDependencies, apiKey: string, path: string, init?: { method?: string; body?: unknown; allowNotFound?: boolean }): Promise<Record<string, unknown>> {
  if (!path.startsWith("/v0/") || path.includes("\\")) throw new Error("Invalid AgentMail operation");
  let response: Response;
  try {
    response = await deps.fetch(origin + path, { method: init?.method ?? "GET", headers: { Authorization: `Bearer ${apiKey}`, ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }), redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch { throw new ServiceError(503, { message: "AgentMail 暂时无法连接，请重试" }); }
  if (response.status === 404 && init?.method === "DELETE" && init.allowNotFound) { await response.body?.cancel(); return {}; }
  if (!response.ok) { await response.body?.cancel(); throw new ServiceError(response.status >= 400 && response.status < 500 && response.status !== 429 ? response.status : 502, { message: `AgentMail 请求失败（HTTP ${response.status}），请检查凭证、权限和公网地址` }); }
  if (response.status === 204) return {};
  try { return jsonObject(await boundedBody(response, 10 * 1024 * 1024)); }
  catch { throw new ServiceError(502, { message: "AgentMail 响应格式或大小不正确" }); }
}
export async function connectionKey(deps: CredentialDependencies, connection: typeof integrationConnections.$inferSelect) {
  if (connection.provider !== "agentmail") throw new ServiceError(400, { message: "此连接不是 AgentMail 连接" });
  return await decryptSecret(deps, connection.encryptedCredential, { organizationId: connection.organizationId, id: connection.id, purpose: "agentmail-key" });
}
export async function changeRemoteWebhook(deps: ProviderDependencies & CredentialDependencies, connection: typeof integrationConnections.$inferSelect, endpoint: typeof webhookEndpoints.$inferSelect, enabled: boolean | "delete") {
  if (!endpoint.remoteWebhookId) return;
  if ([".", ".."].includes(endpoint.remoteWebhookId)) throw new ServiceError(502, { message: "AgentMail Webhook ID 不正确" });
  const key = await connectionKey(deps, connection), path = `/v0/webhooks/${encodeURIComponent(endpoint.remoteWebhookId)}`;
  await agentMailRequest(deps, key, path, enabled === "delete" ? { method: "DELETE", allowNotFound: true } : { method: "PATCH", body: { enabled } });
}
export async function agentMailInboxes(deps: ProviderDependencies, key: string): Promise<IntegrationInbox[]> {
  const result: IntegrationInbox[] = [], visited = new Set<string>(); let token = "";
  do {
    if (visited.has(token) || visited.size >= 100) throw new ServiceError(502, { message: "AgentMail 收件箱分页异常" });
    visited.add(token);
    const data = await agentMailRequest(deps, key, `/v0/inboxes?limit=100${token ? `&page_token=${encodeURIComponent(token)}` : ""}`);
    const parsed = z.object({ inboxes: z.array(z.object({ inbox_id: z.string().min(1), email: z.string().min(1), display_name: z.string().nullish() })), next_page_token: z.string().nullish() }).safeParse(data);
    if (!parsed.success) throw new ServiceError(502, { message: "AgentMail 收件箱响应格式不正确" });
    result.push(...parsed.data.inboxes.map(item => ({ inboxId: item.inbox_id, address: item.email, ...(item.display_name ? { displayName: item.display_name } : {}) })));
    token = parsed.data.next_page_token ?? "";
  } while (token);
  return result;
}
const stringList = z.array(z.string()).default([]);
const messageSchema = z.object({ inbox_id: z.string().min(1).max(300), message_id: z.string().min(1).max(1000), thread_id: z.string().nullish(),
  from: z.string().nullish(), from_: z.union([z.string(), z.array(z.string())]).nullish(), to: stringList, cc: stringList, reply_to: stringList,
  subject: z.string().nullish(), preview: z.string().nullish(), text: z.string().nullish(), html: z.string().nullish(), timestamp: z.string().nullish(),
  attachments: z.array(z.object({ attachment_id: z.string(), filename: z.string().nullish(), content_type: z.string().nullish(), size: z.number().nonnegative().nullish() })).default([]),
});
export function normalizeAgentMailMessage(raw: unknown, fallbackReceivedAt: string): Record<string, unknown> {
  const result = messageSchema.safeParse(raw);
  if (!result.success) throw new ServiceError(400, { message: "AgentMail 邮件事件格式不正确" });
  const value = result.data, senders = value.from ? [value.from] : Array.isArray(value.from_) ? value.from_ : value.from_ ? [value.from_] : [];
  const receivedAt = value.timestamp && Number.isFinite(Date.parse(value.timestamp)) ? new Date(value.timestamp).toISOString() : fallbackReceivedAt;
  return { messageId: value.message_id, inboxId: value.inbox_id, threadId: value.thread_id ?? null, senders, to: value.to, cc: value.cc, replyTo: value.reply_to,
    subject: value.subject ?? null, preview: value.preview ?? null, text: value.text ?? null, html: value.html ?? null, receivedAt,
    bodyMissing: value.text == null && value.html == null,
    attachments: value.attachments.map(item => ({ attachmentId: item.attachment_id, filename: item.filename ?? null, contentType: item.content_type ?? null, size: item.size ?? null })) };
}
/** Worker-only enrichment after durable ACK; never fetch a URL supplied by email. */
export async function hydrateAgentMailEvent(deps: IntegrationDependencies, event: ExternalAutomationEvent): Promise<ExternalAutomationEvent> {
  if (event.source.kind !== "agentmail") return event;
  const message = event.data.message as Record<string, unknown> | undefined;
  if (!message?.bodyMissing) return event;
  if (message.inboxId !== event.source.inboxId || typeof message.messageId !== "string") throw new Error("Invalid verified message context");
  if ([event.source.inboxId, message.messageId].some(id => id === "." || id === "..")) throw new Error("Invalid AgentMail message identity");
  const [connection] = await deps.database.select().from(integrationConnections).where(and(eq(integrationConnections.id, event.source.connectionId), eq(integrationConnections.organizationId, event.organizationId), eq(integrationConnections.provider, "agentmail"), eq(integrationConnections.enabled, true), isNull(integrationConnections.deletedAt)));
  if (!connection) throw new Error("AgentMail connection is no longer available");
  const full = await agentMailRequest(deps, await connectionKey(deps, connection), `/v0/inboxes/${encodeURIComponent(event.source.inboxId)}/messages/${encodeURIComponent(message.messageId)}`);
  const normalized = normalizeAgentMailMessage(full, event.occurredAt);
  if (normalized.inboxId !== event.source.inboxId || normalized.messageId !== message.messageId) throw new Error("AgentMail message identity mismatch");
  return { ...event, data: { ...event.data, message: normalized } };
}

const outboundResultSchema = z.object({ message_id: z.string().min(1), thread_id: z.string().min(1) });
type OutboundDependencies = Pick<IntegrationDependencies, "database" | "fetch" | "encryptionKey">;

async function outboundAgentMailMessage(deps: OutboundDependencies, organizationId: string,
  input: SendAgentMailMessageInput | ReplyAgentMailMessageInput): Promise<{ messageId: string; threadId: string }> {
  const key = await verifiedAgentMailKey(deps, organizationId, input);
  const reply = "messageId" in input;
  const path = `/v0/inboxes/${encodeURIComponent(input.inboxId)}/messages/${reply ? `${encodeURIComponent(input.messageId)}/reply` : "send"}`;
  const body = {
    ...(input.to?.length ? { to: input.to } : {}),
    ...(input.cc?.length ? { cc: input.cc } : {}),
    ...(input.bcc?.length ? { bcc: input.bcc } : {}),
    ...(input.replyTo?.length ? { reply_to: input.replyTo } : {}),
    ...("subject" in input && input.subject !== undefined ? { subject: input.subject } : {}),
    ...(reply && input.replyAll !== undefined ? { reply_all: input.replyAll } : {}),
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.html !== undefined ? { html: input.html } : {}),
  };
  const result = outboundResultSchema.safeParse(await agentMailRequest(deps, key, path, { method: "POST", body }));
  if (!result.success) throw new ServiceError(502, { message: "AgentMail 发信响应格式不正确" });
  return { messageId: result.data.message_id, threadId: result.data.thread_id };
}

export async function sendAgentMailMessage(deps: OutboundDependencies, input: SendAgentMailMessageInput & { organizationId: string }): Promise<{ messageId: string; threadId: string }> {
  const { organizationId, ...message } = input;
  const parsed = sendAgentMailMessageSchema.safeParse(message);
  if (!parsed.success) throw new ServiceError(400, { message: "AgentMail 发信参数不正确" });
  return outboundAgentMailMessage(deps, organizationId, parsed.data);
}

export async function replyAgentMailMessage(deps: OutboundDependencies, input: ReplyAgentMailMessageInput & { organizationId: string }): Promise<{ messageId: string; threadId: string }> {
  const { organizationId, ...message } = input;
  const parsed = replyAgentMailMessageSchema.safeParse(message);
  if (!parsed.success) throw new ServiceError(400, { message: "AgentMail 回复参数不正确" });
  return outboundAgentMailMessage(deps, organizationId, parsed.data);
}

/** Shared boundary for reads and sends: tenant, enabled connection, and live inbox membership. */
async function verifiedAgentMailKey(deps: OutboundDependencies, organizationId: string, input: { connectionId: string; inboxId: string }) {
  const [connection] = await deps.database.select().from(integrationConnections).where(and(
    eq(integrationConnections.id, input.connectionId), eq(integrationConnections.organizationId, organizationId),
    eq(integrationConnections.provider, "agentmail"), eq(integrationConnections.enabled, true), isNull(integrationConnections.deletedAt),
  ));
  if (!connection) throw new ServiceError(404, { message: "集成不存在或已停用" });
  const key = await connectionKey(deps, connection);
  const inboxes = await agentMailInboxes(deps, key);
  if (!inboxes.some(inbox => inbox.inboxId === input.inboxId)) throw new ServiceError(400, { message: "AgentMail 收件箱不属于此连接" });
  return key;
}

export async function listAgentMailInboxes(deps: OutboundDependencies, organizationId: string, connectionId?: string) {
  const connections = await deps.database.select().from(integrationConnections).where(and(
    eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.enabled, true),
    eq(integrationConnections.provider, "agentmail"), isNull(integrationConnections.deletedAt),
    ...(connectionId ? [eq(integrationConnections.id, connectionId)] : []),
  ));
  if (!connections.length) throw new ServiceError(404, { message: "请先在设置中连接 AgentMail，或选择当前工作区已启用的连接" });
  const result = [];
  for (const connection of connections) {
    result.push({ connectionId: connection.id, name: connection.name,
      inboxes: await agentMailInboxes(deps, await connectionKey(deps, connection)) });
  }
  return { connections: result };
}

export const getAgentMailMessageSchema = z.strictObject({ connectionId: replyAgentMailMessageSchema.shape.connectionId, inboxId: replyAgentMailMessageSchema.shape.inboxId, messageId: replyAgentMailMessageSchema.shape.messageId });

export async function getAgentMailMessage(deps: OutboundDependencies, input: z.infer<typeof getAgentMailMessageSchema> & { organizationId: string }) {
  const { organizationId, ...message } = input;
  const parsed = getAgentMailMessageSchema.safeParse(message);
  if (!parsed.success) throw new ServiceError(400, { message: "AgentMail 读取参数不正确" });
  const { inboxId, messageId } = parsed.data;
  const key = await verifiedAgentMailKey(deps, organizationId, parsed.data);
  const raw = await agentMailRequest(deps, key, `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`);
  const normalized = normalizeAgentMailMessage(raw, new Date().toISOString());
  if (normalized.inboxId !== inboxId || normalized.messageId !== messageId) throw new ServiceError(502, { message: "AgentMail 邮件身份不匹配" });
  return normalized;
}
