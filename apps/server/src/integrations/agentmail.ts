import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { IntegrationInbox } from "@tabdo/shared";
import type { ExternalAutomationEvent } from "../automation/events.js";
import { getDatabase } from "../resources/scope.js";

import { integrationConnections, webhookEndpoints } from "../db/schema.js";
import { decryptSecret } from "./secrets.js";
import { boundedBody, jsonObject } from "./http.js";

const origin = "https://api.agentmail.to";
export async function agentMailRequest(apiKey: string, path: string, init?: { method?: string; body?: unknown; allowNotFound?: boolean }): Promise<Record<string, unknown>> {
  if (!path.startsWith("/v0/") || path.includes("\\")) throw new Error("Invalid AgentMail operation");
  let response: Response;
  try {
    response = await fetch(origin + path, { method: init?.method ?? "GET", headers: { Authorization: `Bearer ${apiKey}`, ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }), redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch { throw new HTTPException(503, { message: "AgentMail 暂时无法连接，请重试" }); }
  if (response.status === 404 && init?.method === "DELETE" && init.allowNotFound) { await response.body?.cancel(); return {}; }
  if (!response.ok) { await response.body?.cancel(); throw new HTTPException(502, { message: `AgentMail 请求失败（HTTP ${response.status}），请检查凭证、权限和公网地址` }); }
  if (response.status === 204) return {};
  try { return jsonObject(await boundedBody(new Request(origin, { method: "POST", body: response.body, duplex: "half" } as RequestInit), 10 * 1024 * 1024)); }
  catch { throw new HTTPException(502, { message: "AgentMail 响应格式或大小不正确" }); }
}
export function connectionKey(connection: typeof integrationConnections.$inferSelect) {
  return decryptSecret(connection.encryptedCredential, { organizationId: connection.organizationId, id: connection.id, purpose: "agentmail-key" });
}
export async function changeRemoteWebhook(connection: typeof integrationConnections.$inferSelect, endpoint: typeof webhookEndpoints.$inferSelect, enabled: boolean | "delete") {
  if (!endpoint.remoteWebhookId) return;
  if ([".", ".."].includes(endpoint.remoteWebhookId)) throw new HTTPException(502, { message: "AgentMail Webhook ID 不正确" });
  const key = connectionKey(connection), path = `/v0/webhooks/${encodeURIComponent(endpoint.remoteWebhookId)}`;
  await agentMailRequest(key, path, enabled === "delete" ? { method: "DELETE", allowNotFound: true } : { method: "PATCH", body: { enabled } });
}
export async function agentMailInboxes(key: string): Promise<IntegrationInbox[]> {
  const result: IntegrationInbox[] = [], visited = new Set<string>(); let token = "";
  do {
    if (visited.has(token) || visited.size >= 100) throw new HTTPException(502, { message: "AgentMail 收件箱分页异常" });
    visited.add(token);
    const data = await agentMailRequest(key, `/v0/inboxes?limit=100${token ? `&page_token=${encodeURIComponent(token)}` : ""}`);
    const parsed = z.object({ inboxes: z.array(z.object({ inbox_id: z.string().min(1), email: z.string().min(1), display_name: z.string().nullish() })), next_page_token: z.string().nullish() }).safeParse(data);
    if (!parsed.success) throw new HTTPException(502, { message: "AgentMail 收件箱响应格式不正确" });
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
export function normalizeAgentMailMessage(raw: unknown, fallbackReceivedAt = new Date().toISOString()): Record<string, unknown> {
  const result = messageSchema.safeParse(raw);
  if (!result.success) throw new HTTPException(400, { message: "AgentMail 邮件事件格式不正确" });
  const value = result.data, senders = value.from ? [value.from] : Array.isArray(value.from_) ? value.from_ : value.from_ ? [value.from_] : [];
  const receivedAt = value.timestamp && Number.isFinite(Date.parse(value.timestamp)) ? new Date(value.timestamp).toISOString() : fallbackReceivedAt;
  return { messageId: value.message_id, inboxId: value.inbox_id, threadId: value.thread_id ?? null, senders, to: value.to, cc: value.cc, replyTo: value.reply_to,
    subject: value.subject ?? null, preview: value.preview ?? null, text: value.text ?? null, html: value.html ?? null, receivedAt,
    bodyMissing: value.text == null && value.html == null,
    attachments: value.attachments.map(item => ({ attachmentId: item.attachment_id, filename: item.filename ?? null, contentType: item.content_type ?? null, size: item.size ?? null })) };
}
/** Worker-only enrichment after durable ACK; never fetch a URL supplied by email. */
export async function hydrateAgentMailEvent(event: ExternalAutomationEvent): Promise<ExternalAutomationEvent> {
  if (event.source.kind !== "agentmail") return event;
  const message = event.data.message as Record<string, unknown> | undefined;
  if (!message?.bodyMissing) return event;
  if (message.inboxId !== event.source.inboxId || typeof message.messageId !== "string") throw new Error("Invalid verified message context");
  if ([event.source.inboxId, message.messageId].some(id => id === "." || id === "..")) throw new Error("Invalid AgentMail message identity");
  const [connection] = await getDatabase().select().from(integrationConnections).where(and(eq(integrationConnections.id, event.source.connectionId), eq(integrationConnections.organizationId, event.organizationId), eq(integrationConnections.enabled, true), isNull(integrationConnections.deletedAt)));
  if (!connection) throw new Error("AgentMail connection is no longer available");
  const full = await agentMailRequest(connectionKey(connection), `/v0/inboxes/${encodeURIComponent(event.source.inboxId)}/messages/${encodeURIComponent(message.messageId)}`);
  const normalized = normalizeAgentMailMessage(full, event.occurredAt);
  if (normalized.inboxId !== event.source.inboxId || normalized.messageId !== message.messageId) throw new Error("AgentMail message identity mismatch");
  return { ...event, data: { ...event.data, message: normalized } };
}
