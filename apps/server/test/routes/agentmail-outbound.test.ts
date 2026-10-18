import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { sendAgentMailMessage, replyAgentMailMessage } from "../../src/business/integrations/agentmail.js";
import { encryptSecret } from "../../src/business/integrations/secrets.js";
import { ServiceError } from "../../src/business/errors.js";
import { sendAgentMailMessageSchema, replyAgentMailMessageSchema } from "@tabdo/shared";

const connectionId = "00000000-0000-4000-8000-000000000001";
const organizationId = "org-fixture";
const inboxId = "mail/+?#@fixture.test";
const base = { organizationId, connectionId, inboxId, text: "Hello" };
const send = { ...base, to: ["Recipient <reader@example.test>"], subject: "Subject" };

test("outbound schemas enforce bodies, address limits, identities and no attachments", () => {
  const { organizationId: _, ...input } = send;
  assert(sendAgentMailMessageSchema.safeParse(input).success);
  for (const patch of [{ to: [] }, { to: ["bad"] }, { to: ["a@b.test\r\nBcc: x@y.test"] }, { text: " " }, { text: "x".repeat(200001) }, { inboxId: ".." }, { attachments: [] }]) {
    assert.equal(sendAgentMailMessageSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert(replyAgentMailMessageSchema.safeParse({ connectionId, inboxId, messageId: "<id@example.test>", html: "<p>Hello</p>" }).success);
  assert.equal(replyAgentMailMessageSchema.safeParse({ connectionId, inboxId, messageId: ".", text: "Hello" }).success, false);
});

test("send/reply protocol and tenant boundaries without database or real network", async () => {
  const encryptionKey = "12".repeat(32);
  const encryptedCredential = await encryptSecret({ encryptionKey }, "fixture-api-key", { organizationId, id: connectionId, purpose: "agentmail-key" });
  let provider = "agentmail";
  let enabled = true, deletedAt: Date | null = null;
  let status = 200, malformed = false, failNetwork = false;
  const posts: { path: string; body: unknown }[] = [];
  let requests = 0;
  const database = { select: () => ({ from: () => ({ where: async (condition: SQL) => {
    const query = new PgDialect().sqlToQuery(condition);
    assert.match(query.sql, /"enabled" =/);
    assert.match(query.sql, /"deleted_at" is null/);
    assert.match(query.sql, /"provider" =/);
    assert.deepEqual(query.params.slice(2), ["agentmail", true]);
    return query.params[0] === connectionId && query.params[1] === organizationId && provider === "agentmail" && enabled && !deletedAt
      ? [{ id: connectionId, organizationId, provider, encryptedCredential }] : [];
  } }) }) };
  const deps = {
    database: database as unknown as Parameters<typeof sendAgentMailMessage>[0]["database"], encryptionKey,
    fetch: (async (url, init) => {
      requests++;
      assert.equal(init?.headers && new Headers(init.headers).get("Authorization"), "Bearer fixture-api-key");
      assert.equal(init?.redirect, "error");
      assert(init?.signal);
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, "https://api.agentmail.to");
      if (parsed.pathname === "/v0/inboxes") {
        assert.equal(init?.method, "GET");
        return Response.json(parsed.searchParams.has("page_token")
          ? { inboxes: [{ inbox_id: inboxId, email: "mail@fixture.test" }] }
          : { inboxes: [], next_page_token: "next/+" });
      }
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init.headers).get("Content-Type"), "application/json");
      posts.push({ path: parsed.pathname, body: JSON.parse(String(init.body)) });
      if (failNetwork) throw new Error("fixture offline");
      return Response.json(malformed ? { message_id: "sent" } : { message_id: "sent", thread_id: "thread" }, { status });
    }) as typeof fetch,
  };
  const result = { messageId: "sent", threadId: "thread" };
  assert.deepEqual(await sendAgentMailMessage(deps, { ...send, cc: [], bcc: ["blind@example.test"], replyTo: ["reply@example.test"], html: "<p>Hello</p>" }), result);
  assert.deepEqual(posts[0], { path: `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`, body: {
    to: send.to, bcc: ["blind@example.test"], reply_to: ["reply@example.test"], subject: "Subject", text: "Hello", html: "<p>Hello</p>",
  } });
  const messageId = "<original/+?#@fixture.test>";
  assert.deepEqual(await replyAgentMailMessage(deps, { ...base, messageId, replyAll: false, to: [], cc: ["copy@example.test"] }), result);
  assert.deepEqual(posts[1], { path: `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`, body: { cc: ["copy@example.test"], reply_all: false, text: "Hello" } });
  const error = (status: number) => (value: unknown) => value instanceof ServiceError && value.status === status;
  for (const operation of [() => sendAgentMailMessage(deps, send), () => replyAgentMailMessage(deps, { ...base, messageId })]) {
    for (const failure of [400, 401, 404, 429, 500]) { status = failure; await assert.rejects(operation, error(failure < 500 && failure !== 429 ? failure : 502)); }
    status = 200; malformed = true; await assert.rejects(operation, error(502)); malformed = false;
    failNetwork = true; await assert.rejects(operation, error(503)); failNetwork = false;
  }
  const before = requests;
  await assert.rejects(() => sendAgentMailMessage(deps, { ...send, organizationId: "other-org" }), error(404));
  provider = "other"; await assert.rejects(() => sendAgentMailMessage(deps, send), error(404)); provider = "agentmail";
  enabled = false; await assert.rejects(() => sendAgentMailMessage(deps, send), error(404)); enabled = true;
  deletedAt = new Date(); await assert.rejects(() => sendAgentMailMessage(deps, send), error(404)); deletedAt = null;
  await assert.rejects(() => replyAgentMailMessage(deps, { ...base, messageId: ".." }), error(400));
  assert.equal(requests, before, "invalid context never contacts provider");
  const postCount = posts.length;
  await assert.rejects(() => sendAgentMailMessage(deps, { ...send, inboxId: "foreign@fixture.test" }), error(400));
  assert.equal(posts.length, postCount, "unlisted inbox never sends");
});

 test("management rejects other providers before credentials or network access", async () => {
  const services = await import("../../src/business/services/integrations.js");
  const deps = { database: { select: () => ({ from: () => ({ where: async () => [{ provider: "other" }] }) }) },
    fetch: () => { throw new Error("must not contact provider"); } } as unknown as Parameters<typeof services.listInboxes>[0];
  const actor = { organizationId } as Parameters<typeof services.listInboxes>[1];
  for (const operation of [services.listInboxes, services.testConnection, services.updateConnection, services.deleteConnection, services.registerWebhook]) {
    await assert.rejects(() => operation(deps, actor, new Request("https://fixture.test"), connectionId),
      (error: unknown) => error instanceof ServiceError && error.status === 400 && error.message.includes("AgentMail"));
  }
});
