import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { executeNext, recordFailure, PermanentError, type AutomationExecutionDependencies } from "../../src/business/automation/execution.js";
import { ServiceError } from "../../src/business/errors.js";
import { automationRuns, automationStepReceipts } from "../../src/business/db/schema.js";

function fixture(type: "send_email" | "reply_email", failure?: Error) {
  const organizationId = randomUUID(), connectionId = randomUUID(), workspaceId = randomUUID();
  const action = { type, connectionId, inboxId: "out@example.com", text: { $event: "message.text" },
    ...(type === "send_email" ? { to: { $event: "message.senders" }, subject: { $event: "message.subject" } }
      : { messageId: { $event: "message.messageId" }, replyAll: true }) };
  const rule = { workspaceId, actions: [action], eventConditions: [] };
  const event = { id: randomUUID(), organizationId, workspaceId, fence: 1, snapshot: { protocol: 2,
    event: { source: { kind: "webhook" }, data: { message: { senders: ["to@example.com"], subject: "Hello", text: "Body", messageId: "original" } } } } };
  const run = { id: randomUUID(), organizationId, workspaceId, nextStep: 0, status: "running", detail: {}, ruleSnapshot: rule };
  const results = [[event], [event], [run], [{ organizationId, workspaceId, enabled: true, createdByUserId: "actor" }], [{}], [],
    [event], [run]];
  let inTransaction = false;
  const receipts: unknown[] = [], updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const query = (value: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "for", "orderBy", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(value).then(resolve);
    return chain;
  };
  const database = {
    select: () => query(results.shift()),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      assert.equal(inTransaction, false); inTransaction = true;
      try { return await fn(database); } finally { inTransaction = false; }
    },
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => {
      updates.push({ table, values }); return query([]);
    } }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      if (table === automationStepReceipts) receipts.push(value); return Promise.resolve();
    } }),
  };
  let sent: Record<string, unknown> | undefined;
  const send = async (input: Record<string, unknown>) => {
    assert.equal(inTransaction, false, "provider must run outside transactions");
    sent = input;
    if (failure) throw failure;
    return { messageId: "sent", threadId: "thread" };
  };
  const deps = { database, now: () => new Date(), sendAgentMailMessage: send, replyAgentMailMessage: send } as unknown as AutomationExecutionDependencies;
  return { deps, event, receipts, updates, get sent() { return sent; } };
}

for (const type of ["send_email", "reply_email"] as const) test(type + " resolves bindings outside transactions and commits receipt", async () => {
  const f = fixture(type);
  assert.equal(await executeNext(f.deps, f.event.id, 1), "continue");
  assert.equal(f.sent?.text, "Body");
  assert.equal(f.sent?.organizationId, f.event.organizationId);
  if (type === "send_email") {
    assert.deepEqual(f.sent?.to, ["to@example.com"]); assert.equal(f.sent?.subject, "Hello");
  } else assert.equal(f.sent?.messageId, "original");
  assert.equal(f.receipts.length, 1);
  assert.equal((f.receipts[0] as { result: { messageId: string } }).result.messageId, "sent");
  assert(f.updates.some(update => update.table === automationRuns && update.values.status === "completed"));
});

for (const status of [400, 404, 503]) test("mail HTTP " + status + " creates no receipt and records real failure", async () => {
  const failure = new ServiceError(status, { message: "Provider failed" }), f = fixture("send_email", failure);
  let caught: Error | undefined;
  try { await executeNext(f.deps, f.event.id, 1); } catch (error) { caught = error as Error; }
  assert(caught);
  assert.equal(caught instanceof PermanentError, status < 500);
  assert.equal(caught.message, "Provider failed"); assert.equal(f.receipts.length, 0);
  // Simulate the worker's final-attempt failure transaction.
  f.deps.database.select = (() => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "for"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve([f.event]).then(resolve);
    return chain;
  }) as unknown as typeof f.deps.database.select;
  await recordFailure(f.deps, f.event.id, caught, true, 1);
  assert(f.updates.some(update => update.table === automationRuns && update.values.status === "failed" && update.values.error === "Provider failed"));
});

test("mail receipts remain readable without native chat ownership", async () => {
  const { readableRunDetails } = await import("../../src/business/automation/run-visibility.js");
  const f = fixture("send_email");
  const history = [{ run: { id: "run", ruleSnapshot: { actions: [{ type: "send_email" }] },
    detail: { actions: [{ type: "send_email", threadId: "provider-thread" }] } }, actions: [], source: { kind: "webhook" } }];
  const db = { select: () => ({ from: () => ({ where: async () => [] }) }) };
  const readable = await readableRunDetails({ database: db } as unknown as Parameters<typeof readableRunDetails>[0],
    history as unknown as Parameters<typeof readableRunDetails>[1], f.event.organizationId);
  assert(readable.has("run"));
});
