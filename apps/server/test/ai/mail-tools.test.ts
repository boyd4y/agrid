import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATFORM_TOOL_IDS } from "@tabdo/shared";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CommandDependencies } from "../../src/business/dependencies.js";
import { createMailTools } from "../../src/business/agent/tools/mail.js";
import { encryptSecret } from "../../src/business/integrations/secrets.js";
import { getAgentToolCatalog } from "../../src/harness/tool-catalog.js";

test("mail tools enforce host scope, inbox membership, protocol and safe results", async () => {
  const organizationId = "mail-fixture", connectionId = "00000000-0000-4000-8000-000000000001";
  const inboxId = "box/+@example.test", messageId = "<message/+@example.test>";
  const encryptionKey = "12".repeat(32), apiKey = "fixture-only-key";
  const encryptedCredential = await encryptSecret({ encryptionKey }, apiKey, { organizationId, id: connectionId, purpose: "agentmail-key" });
  let enabled = true, deleted = false, mismatch = false, requests = 0;
  const methods: string[] = [];
  const database = { select: () => ({ from: () => ({ where: async (condition: SQL) => {
    const query = new PgDialect().sqlToQuery(condition);
    assert.match(query.sql, /"enabled" =/);
    assert.match(query.sql, /"deleted_at" is null/);
    return query.params.includes(organizationId) && enabled && !deleted &&
      (!query.sql.includes('"id" =') || query.params.includes(connectionId))
      ? [{ id: connectionId, organizationId, name: "Mail", provider: "agentmail", encryptedCredential }] : [];
  } }) }) };
  const deps = { database, integrations: { encryptionKey, fetch: async (url: string, init: RequestInit) => {
    requests++;
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${apiKey}`);
    const path = new URL(url).pathname;
    methods.push(init.method!);
    if (path === "/v0/inboxes") return Response.json({ inboxes: [{ inbox_id: inboxId, email: "box@example.test" }] });
    if (init.method === "POST") {
      assert(path.endsWith("/send") || path.endsWith(`/${encodeURIComponent(messageId)}/reply`));
      assert.equal(JSON.parse(String(init.body)).text, "Hello");
      return Response.json({ message_id: "sent", thread_id: "thread" });
    }
    assert.equal(path, `/v0/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`);
    return Response.json({ inbox_id: inboxId, message_id: mismatch ? "wrong" : messageId, text: "Hello",
      api_key: apiKey, attachments: [{ attachment_id: "a", filename: "file", download_url: "https://example.test/secret" }] });
  } } } as unknown as CommandDependencies;
  const tools = createMailTools(() => deps, organizationId);
  const run = async (id: string, input: object) => tools[id].execute!(input, { toolCallId: id, messages: [], context: undefined });
  const listed = await run("list_mail_inboxes", {});
  assert.deepEqual(listed, { connections: [{ connectionId, name: "Mail", inboxes: [{ inboxId, address: "box@example.test" }] }] });
  const base = { connectionId, inboxId, text: "Hello" };
  for (const [id, input] of [["send_email", { ...base, to: ["reader@example.test"], subject: "Subject" }], ["reply_email", { ...base, messageId }]] as const) {
    assert.deepEqual(await run(id, input), { messageId: "sent", threadId: "thread", connectionId, inboxId });
  }
  const message = await run("get_message", { connectionId, inboxId, messageId });
  assert.equal(JSON.stringify(message).includes(apiKey), false);
  assert.equal(JSON.stringify(message).includes("download_url"), false);
  assert.equal(methods.filter(method => method === "POST").length, 2);
  await assert.rejects(() => run("get_message", { connectionId, inboxId: "foreign", messageId }), /不属于/);
  mismatch = true;
  await assert.rejects(() => run("get_message", { connectionId, inboxId, messageId }), /身份不匹配/);
  const before = requests;
  await assert.rejects(() => createMailTools(deps, "other").get_message.execute!({ connectionId, inboxId, messageId }, { toolCallId: "test", messages: [], context: undefined }), /不存在/);
  enabled = false;
  await assert.rejects(() => run("list_mail_inboxes", {}), /请先/);
  enabled = true; deleted = true;
  await assert.rejects(() => run("get_message", { connectionId, inboxId, messageId }), /不存在/);
  assert.equal(requests, before);
  assert.deepEqual(getAgentToolCatalog("pi").tools.map(tool => tool.id).sort(), [...PLATFORM_TOOL_IDS].sort());
  for (const id of Object.keys(tools)) assert.equal(getAgentToolCatalog("pi").tools.find(tool => tool.id === id)?.group, "邮件");
});
