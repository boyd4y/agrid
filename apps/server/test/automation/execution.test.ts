import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "../runtime.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ExternalAutomationEvent } from "../../src/automation/events.js";

if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const { db, client } = await import("../../src/db/index.js");
const { organization, user, member, rows, automations, automationRuns, automationEvents, automationOutbox, automationStepReceipts, webhookEndpoints, integrationConnections } = await import("../../src/db/schema.js");
const commands = await import("../../src/commands/index.js");
const { createAutomation, replayAutomationRun } = await import("../../src/automation/crud.js");
const { appendExternalAutomationEvent } = await import("../../src/automation/events.js");
const { claimExecution, executeNext, recordFailure, FenceLostError } = await import("../../src/automation/execution.js");
const { encryptSecret } = await import("../../src/integrations/secrets.js");
const org = randomUUID(), owner = randomUUID(), scope = { organizationId: org, actorId: owner };
const runIds: string[] = [];
const fetchOriginal = globalThis.fetch;
before(async () => {
  await db.insert(user).values({ id: owner, name: "Executor fixture", email: `${owner}@local.test` });
  await db.insert(organization).values({ id: org, name: "Executor integration", slug: org });
  await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: org, role: "owner" });
});

test("incomplete legacy conditions and deleted condition columns cannot broaden table triggers", async () => {
  const source = await table("Strict conditions"), target = await table("Strict condition output");
  const rule = await createAutomation({ ...scope, tableId: source.id, name: "Strict saved predicate", trigger: { type: "row_created" },
    conditions: [{ id: "required", columnId: source.title, op: "eq", value: "match" }],
    actions: [{ type: "command", command: "addRow", input: { tableId: target.id } }] });
  await assert.rejects(createAutomation({ ...scope, tableId: source.id, name: "Incomplete predicate", trigger: { type: "row_created" },
    conditions: [{ id: "missing", columnId: source.title, op: "contains", value: "" }], actions: rule.actions }), /条件需要比较值/);
  await db.update(automations).set({ conditions: [{ id: "legacy", columnId: source.title, op: "eq" }] }).where(eq(automations.id, rule.id));
  const first = await commands.addRow({ ...scope, tableId: source.id });
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.rowId, first.id))).length, 0);
  await db.update(automations).set({ conditions: rule.conditions }).where(eq(automations.id, rule.id));
  await commands.deleteColumn({ ...scope, columnId: source.title });
  const second = await commands.addRow({ ...scope, tableId: source.id });
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.rowId, second.id))).length, 0);
});

test("new native actions cannot start for superseded or deleted trigger rows", async () => {
  const { executeNext: execute } = await import("../../src/business/automation/execution.js");
  const { commandDependencies } = await import("../../src/services/dependencies.js");
  for (const change of ["updated", "deleted"] as const) {
    const source = await table(`Stale native ${change}`);
    await db.insert(automations).values({ organizationId: org, createdByUserId: owner, tableId: source.id,
      source: { kind: "table", tableId: source.id }, name: "Native stale guard", trigger: { type: "row_created" },
      actions: [{ type: "run_agent", agentUserId: owner, prompt: "Must not start" }] });
    const row = await commands.addRow({ ...scope, tableId: source.id }), event = await eventFor(row.id);
    if (change === "updated") await commands.updateCell({ ...scope, rowId: row.id, columnId: source.title, value: "Newer input", skipAutomation: true });
    else await commands.deleteRow({ ...scope, rowId: row.id });
    let invocations = 0;
    const deps = { ...commandDependencies(), runAgentAction: async () => { invocations++;throw new Error("Stale native input invoked"); } };
    const fence = await claimExecution(event.id, event.generation);assert(fence !== undefined);
    assert.equal(await execute(deps, event.id, fence), "continue");
    assert.equal(await execute(deps, event.id, fence), "done");
    assert.equal(invocations, 0);
    assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.id, event.id)))[0].status, change === "updated" ? "superseded" : "cancelled");
  }
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  if (runIds.length) await db.delete(automationRuns).where(inArray(automationRuns.id, runIds));
  await db.delete(automationEvents).where(eq(automationEvents.organizationId, org));
  await db.delete(organization).where(eq(organization.id, org));
  await db.delete(user).where(eq(user.id, owner));
  await client.end();
});
async function table(name: string) {
  const created = await commands.createTable({ ...scope, name });
  return { id: created.id, title: (await commands.getTable({ ...scope, tableId: created.id })).columns[0].id };
}
async function tracked(eventId: string) {
  const runs = await db.select().from(automationRuns).where(eq(automationRuns.eventId, eventId));
  runIds.push(...runs.map(run => run.id));return runs;
}
async function eventFor(rowId: string) {
  const [event] = await db.select().from(automationEvents).where(and(eq(automationEvents.organizationId, org), eq(automationEvents.rowId, rowId)));
  assert(event);await tracked(event.id);return event;
}
async function drain(eventId: string, generation = 0) {
  const fence = await claimExecution(eventId, generation);assert(fence !== undefined);
  for (let attempts = 0; attempts < 20; attempts++) if (await executeNext(eventId, fence) === "done") return fence;
  throw new Error("Fixture did not finish its finite action plan");
}
const receiptList = (runId: string) => db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId, runId)).orderBy(asc(automationStepReceipts.step));
function external(source: ExternalAutomationEvent["source"], data: Record<string, unknown>, type: ExternalAutomationEvent["type"] = "webhook_received"): ExternalAutomationEvent {
  const id = randomUUID();return { id, organizationId: org, source, type, occurredAt: new Date().toISOString(), data, traceId: id };
}
async function append(event: ExternalAutomationEvent) {
  const id = await db.transaction(tx => appendExternalAutomationEvent(tx, event));
  if (id) await tracked(id);return id;
}

test("table actions execute in order with typed event/step bindings, CAS versions and one receipt per mutation", async () => {
  const source = await table("Table source"), target = await table("Table destination");
  const amount = await commands.addColumn({ ...scope, tableId: source.id, name: "Amount", type: "number" });
  const targetAmount = await commands.addColumn({ ...scope, tableId: target.id, name: "Amount", type: "number" });
  await createAutomation({ ...scope, tableId: source.id, name: "Ordered actions", trigger: { type: "row_created" }, actions: [
    { type: "update_field", columnId: amount.id, value: 2 },
    { type: "command", command: "addRow", input: { tableId: target.id, cells: { [target.title]: { $event: "row.id" }, [targetAmount.id]: { $event: `row.cells.${amount.id}` } } } },
    { type: "command", command: "updateCell", input: { rowId: { $step: { index: 1, path: "result.id" } }, columnId: targetAmount.id, value: { $step: { index: 0, path: "value" } } } },
  ] });
  const sourceRow = await commands.addRow({ ...scope, tableId: source.id, cells: { [amount.id]: 0 } });
  const event = await eventFor(sourceRow.id), [run] = await tracked(event.id);
  const fence = await drain(event.id);
  const receipts = await receiptList(run.id);assert.deepEqual(receipts.map(receipt => receipt.step), [0, 1, 2]);
  assert.deepEqual(receipts[1].result.type, "command");assert.equal(receipts[1].result.command, "addRow");
  const targetRowId = (receipts[1].result.result as { id: string }).id;
  const saved = await commands.getRow({ ...scope, rowId: targetRowId });
  assert.equal(saved.cells[target.title], sourceRow.id);assert.equal(saved.cells[targetAmount.id], 2);
  assert.equal((await commands.getRow({ ...scope, rowId: sourceRow.id })).version, 2);
  assert.equal((await db.select().from(automationEvents).where(eq(automationEvents.id, event.id)))[0].expectedVersion, 2);
  assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.id, run.id)))[0].nextStep, 3);
  assert.equal(await executeNext(event.id, fence), "done");assert.equal((await db.select().from(rows).where(eq(rows.tableId, target.id))).length, 1);
});

test("verified external events match their source and typed conditions without inventing a table row", async () => {
  const target = await table("External destination");
  const amount = await commands.addColumn({ ...scope, tableId: target.id, name: "Count", type: "number" });
  const enabled = await commands.addColumn({ ...scope, tableId: target.id, name: "Enabled", type: "checkbox" });
  const endpointId = randomUUID();
  await db.insert(webhookEndpoints).values({ id: endpointId, organizationId: org, createdByUserId: owner, name: "Verified fixture", kind: "webhook" });
  const source = { kind: "webhook" as const, endpointId };
  await createAutomation({ ...scope, source, name: "Typed external event", trigger: { type: "webhook_received" }, eventConditions: [
    { id: "zero", path: "payload.count", op: "eq", value: 0 }, { id: "false", path: "payload.enabled", op: "eq", value: false },
    { id: "text", path: "payload.subject", op: "contains", value: "real" },
  ], actions: [
    { type: "command", command: "addRow", input: { tableId: target.id, cells: { [target.title]: { $event: "payload.subject" }, [amount.id]: { $event: "payload.count" }, [enabled.id]: { $event: "payload.enabled" } } } },
    { type: "command", command: "updateCell", input: { rowId: { $step: { index: 0, path: "result.id" } }, columnId: target.title, value: { $event: "payload.final" } } },
  ] });
  const data = { payload: { subject: "real incoming data", count: 0, enabled: false, final: "After first receipt" } };
  assert.equal(await append(external({ kind: "webhook", endpointId: randomUUID() }, data)), null);
  assert.equal(await append(external(source, data, "schedule_due")), null);
  assert.equal(await append(external(source, { payload: { ...data.payload, enabled: true } })), null);
  assert.equal(await append({ ...external(source, data), organizationId: randomUUID() }), null);
  const id = await append(external(source, data));assert(id);await drain(id);
  const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, id));
  assert.equal(event.tableId, null);assert.equal(event.rowId, null);assert.equal(event.rowVersion, null);assert.equal(event.expectedVersion, null);
  const saved = await db.select().from(rows).where(eq(rows.tableId, target.id));assert.equal(saved.length, 1);
  assert.equal(saved[0].cells[target.title], "After first receipt");assert.equal(saved[0].cells[amount.id], 0);assert.equal(saved[0].cells[enabled.id], false);
  assert.equal(event.status, "completed");

  // The actual agent tools must discover and inspect non-table rules even from a table conversation.
  const { createTableTools } = await import("../../src/ai/tools.js");
  const tools = createTableTools(target.id, org, owner);
  const options = { toolCallId: "automation-query-fixture", messages: [] };
  const all = await tools.list_automations.execute({}, options);
  const externalRule = all.find((rule: any) => rule.source.kind === "webhook" && rule.source.endpointId === endpointId);
  assert(externalRule);
  const first = await tools.list_automations.execute({ limit: 1 }, options);
  const next = await tools.list_automations.execute({ limit: 1, offset: 1 }, options);
  assert.deepEqual([first[0].id, next[0].id], all.slice(0, 2).map((rule: any) => rule.id));
  const filtered = await tools.list_automations.execute({ tableId: target.id }, options);
  assert(!filtered.some((rule: any) => rule.id === externalRule.id));
  const inspected = await tools.list_automation_runs.execute({ automationId: externalRule.id }, options);
  assert.equal(inspected.length, 1);assert.equal(inspected[0].status, "completed");assert.equal(inspected[0].tableId, null);
  assert.equal(inspected[0].ruleSnapshot, undefined);
  await assert.rejects(tools.list_automation_runs.execute({ tableId: target.id, automationId: externalRule.id }, options), /不属于/);
  await assert.rejects(commands.listAutomations({}), /组织/);
  await assert.rejects(commands.listAutomationRuns({}), /组织/);
  const foreign = randomUUID();
  await db.insert(organization).values({ id: foreign, name: "Foreign automation", slug: foreign });
  try {
    await db.insert(member).values({ id: randomUUID(), userId: owner, organizationId: foreign, role: "owner" });
    const foreignTarget = await commands.createTable({ organizationId: foreign, name: "Foreign destination" });
    const foreignRule = await createAutomation({ organizationId: foreign, actorId: owner, name: "Private schedule", source: { kind: "schedule", cron: "0 9 * * *", timeZone: "UTC" }, trigger: { type: "schedule_due" }, actions: [{ type: "command", command: "addRow", input: { tableId: foreignTarget.id } }] });
    assert(!(await tools.list_automations.execute({}, options)).some((rule: any) => rule.id === foreignRule.id));
    await assert.rejects(tools.list_automation_runs.execute({ automationId: foreignRule.id }, options), /不存在/);
  } finally { await db.delete(organization).where(eq(organization.id, foreign)); }
});

test("a real receipt insertion failure rolls back its batch; retry preserves prior receipts and executes only the remaining step", async () => {
  const source = await table("Receipt source"), target = await table("Receipt destination");
  await createAutomation({ ...scope, tableId: source.id, name: "Atomic receipts", trigger: { type: "row_created" }, actions: [
    { type: "command", command: "addRow", input: { tableId: target.id, cells: { [target.title]: "Already committed" } } },
    { type: "command", command: "batchAddRows", input: { tableId: target.id, rows: [{ cells: { [target.title]: "Batch A" } }, { cells: { [target.title]: "Batch B" } }] } },
  ] });
  const row = await commands.addRow({ ...scope, tableId: source.id }), event = await eventFor(row.id), [run] = await tracked(event.id);
  const fence = await claimExecution(event.id, event.generation);assert(fence !== undefined);
  assert.equal(await executeNext(event.id, fence), "continue");
  const firstReceipt = (await receiptList(run.id))[0];
  const name = `fixture_receipt_${randomUUID().replaceAll("-", "")}`;
  // Scope the temporary trigger to this fixture's UUID; concurrent workers and other organizations are unaffected.
  await db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id = '${run.id}'::uuid AND NEW.step = 1 THEN RAISE EXCEPTION 'Fixture receipt failure'; END IF; RETURN NEW; END $$`));
  try {
    await db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON automation_step_receipts FOR EACH ROW EXECUTE FUNCTION ${name}()`));
    try { await assert.rejects(executeNext(event.id, fence), error => String((error as { cause?: Error }).cause ?? error).includes("Fixture receipt failure")); }
    finally { await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON automation_step_receipts`)); }
  } finally { await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${name}()`)); }
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, target.id))).length, 1, "business batch rolled back when its receipt failed");
  assert.deepEqual(await receiptList(run.id), [firstReceipt]);
  assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.id, run.id)))[0].nextStep, 1);
  await recordFailure(event.id, new Error("Receipt failed"), true, fence, event.generation);
  await replayAutomationRun(run.id, org);
  const [retry] = await db.select().from(automationEvents).where(eq(automationEvents.id, event.id));assert.equal(retry.generation, 1);
  await assert.rejects(executeNext(event.id, fence), FenceLostError);
  await drain(event.id, retry.generation);
  assert.equal((await db.select().from(rows).where(eq(rows.tableId, target.id))).length, 3);
  const receipts = await receiptList(run.id);assert.equal(receipts.length, 2);assert.deepEqual(receipts[0], firstReceipt);
  assert.equal((await db.select().from(automationRuns).where(eq(automationRuns.id, run.id)))[0].status, "completed");
});

test("AgentMail missing bodies are durably queued then matched or skipped against fetched text outside transactions", async () => {
  const target = await table("Hydrated mail");
  const connectionId = randomUUID(), endpointId = randomUUID(), inboxId = `inbox-${randomUUID()}`;
  await db.insert(integrationConnections).values({ id: connectionId, organizationId: org, createdByUserId: owner, provider: "agentmail", name: "Mail fixture",
    encryptedCredential: encryptSecret("fixture-not-a-live-key", { organizationId: org, id: connectionId, purpose: "agentmail-key" }) });
  await db.insert(webhookEndpoints).values({ id: endpointId, organizationId: org, createdByUserId: owner, kind: "agentmail", name: "Mail webhook", connectionId, inboxIds: [inboxId] });
  const source = { kind: "agentmail" as const, connectionId, inboxId };
  await createAutomation({ ...scope, source, name: "Full body condition", trigger: { type: "message_received" }, eventConditions: [{ id: "body", path: "message.text", op: "contains", value: "ACCEPT" }], actions: [
    { type: "command", command: "addRow", input: { tableId: target.id, cells: { [target.title]: { $event: "message.text" } } } },
  ] });
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));assert.equal(url.origin, "https://api.agentmail.to");assert.equal(init?.method, "GET");
    const messageId = decodeURIComponent(url.pathname.split("/").at(-1)!);assert(url.pathname.startsWith(`/v0/inboxes/${encodeURIComponent(inboxId)}/messages/`));
    calls++;return Response.json({ inbox_id: inboxId, message_id: messageId, text: messageId === "accept" ? "ACCEPT the full body" : "Ignore this body" });
  };
  try {
    for (const messageId of ["accept", "skip"]) {
      const id = await append(external(source, { message: { messageId, inboxId, preview: "No full text here", text: null, html: null, bodyMissing: true } }, "message_received"));assert(id, "ACK durable candidate even though body condition is initially unknown");
      const [run] = await tracked(id);await drain(id);
      const [saved] = await db.select().from(automationRuns).where(eq(automationRuns.id, run.id));assert.equal(saved.status, messageId === "accept" ? "completed" : "skipped");
      const [event] = await db.select().from(automationEvents).where(eq(automationEvents.id, id));
      assert.equal(((event.snapshot.event as ExternalAutomationEvent).data.message as { bodyHydrated: boolean }).bodyHydrated, true);
    }
    assert.equal(calls, 2, "each full body is fetched once, including nonmatching messages");
    const saved = await db.select().from(rows).where(eq(rows.tableId, target.id));assert.equal(saved.length, 1);assert.equal(saved[0].cells[target.title], "ACCEPT the full body");
  } finally { globalThis.fetch = fetchOriginal; }
});
