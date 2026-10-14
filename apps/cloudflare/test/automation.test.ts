import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and,eq,inArray } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import type { CommandDependencies } from "@tabdo/backend/dependencies";
import * as commands from "@tabdo/backend/commands";
import { createAutomation } from "@tabdo/backend/automation/crud";
import { reconcileNativeAutomations } from "@tabdo/backend/automation/execution";
import { dispatchDueSchedules } from "@tabdo/backend/automation/schedule";
import { agentExecutions,agentProfile,agentRuns,automationAgentActions,automationEvents,automationRuns,automationStepReceipts,chatThreads,member,organization,rows,user } from "@tabdo/backend/schema";
import type { NativeExecutionReference } from "@tabdo/backend/agent/executions";
import type { AutomationDelivery } from "@tabdo/shared";
import { createProductAutomationServices } from "../src/automation.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("CF automation adapter commits data receipts and finite native handoffs without waiting or replaying unknown work", { timeout: 30000 },async () => {
  const resource = createDatabase({ connectionString: databaseUrl,poolMax: 1 }),db = resource.db;
  const org = randomUUID(),owner = randomUUID(),agentUser = randomUUID(),agentMember = randomUUID();
  const deps: CommandDependencies = { database: db,uuid: randomUUID,now: () => new Date(),automationQueueName: "automation" };
  const actor = { organizationId: org,actorId: owner };
  const ruleIds: string[] = [],dispatched: NativeExecutionReference[] = [],continuations: AutomationDelivery[] = [];
  const service = createProductAutomationServices({
    acquire: async () => ({ runtime: deps,commands: deps,identity: { database: db,resolveSession: async () => null },builtins: [],close: async () => {} }),
    runtimeEnvironment: () => ({ PI_API_KEY: "fixture-only",PI_BASE_URL: "http://unreached-provider.invalid/v1",PI_MODEL: "fixture" }),
    dispatch: async (_env,reference) => { dispatched.push(reference); },
    requeue: async (_env,delivery) => { continuations.push(delivery); },
  });
  const delivery = async (rowId: string) => {
    const [event] = await db.select().from(automationEvents).where(and(eq(automationEvents.organizationId,org),eq(automationEvents.rowId,rowId)));
    assert(event);return { protocol: 1 as const,eventId: event.id,generation: event.generation };
  };
  try {
    await db.insert(user).values([{ id: owner,name: "CF automation owner",email: `${owner}@local.test` },{ id: agentUser,name: "CF scheduled agent",email: `${agentUser}@local.test`,kind: "agent" }]);
    await db.insert(organization).values({ id: org,name: "CF automation boundary",slug: org });
    await db.insert(member).values([{ id: owner,userId: owner,organizationId: org,role: "owner" },{ id: agentMember,userId: agentUser,organizationId: org }]);
    await db.insert(agentProfile).values({ userId: agentUser,memberId: agentMember,organizationId: org,displayName: "CF scheduled agent",apiKeyHash: randomUUID(),persona: { defaultHarness: "pi",defaultModel: "fixture",runtime: "local",systemPrompt: "Fixture" } });
    const table = await commands.createTable(deps,{ ...actor,name: "CF automation table" });
    const target = await commands.createTable(deps,{ ...actor,name: "CF action destination" });
    const output = await commands.addColumn(deps,{ ...actor,tableId: table.id,name: "Output",type: "text" });
    const dataRule = await createAutomation(deps,{ ...actor,tableId: table.id,name: "Atomic SQL actions",trigger: { type: "row_created" },actions: [
      { type: "update_field",columnId: output.id,value: "committed" },
      { type: "command",command: "addRow",input: { tableId: target.id } },
    ] });ruleIds.push(dataRule.id);
    const source = await commands.addRow(deps,{ ...actor,tableId: table.id,cells: {} });
    const job = await delivery(source.id);
    await service.accept({},job,1);await service.accept({},job,2);
    assert.equal((await commands.getRow(deps,{ ...actor,rowId: source.id })).cells[output.id],"committed");
    assert.equal((await db.select().from(rows).where(eq(rows.tableId,target.id))).length,1,"duplicate delivery cannot repeat a committed data command");
    const [dataRun] = await db.select().from(automationRuns).where(eq(automationRuns.eventId,job.eventId));
    assert.equal(dataRun.status,"completed");
    assert.equal((await db.select().from(automationStepReceipts).where(eq(automationStepReceipts.runId,dataRun.id))).length,2);
    assert.equal(dispatched.length,0);

    const schedule = await createAutomation(deps,{ ...actor,name: "Finite scheduled handoff",source: { kind: "schedule",cron: "* * * * *",timeZone: "UTC" },trigger: { type: "schedule_due" },actions: [
      { type: "run_agent",agentUserId: agentUser,prompt: "Inspect this event and report." },
      { type: "command",command: "addRow",input: { tableId: target.id } },
    ] });ruleIds.push(schedule.id);
    const now = new Date(Date.now() + 65000);
    await dispatchDueSchedules(deps,now,25,org);await dispatchDueSchedules(deps,now,25,org);
    const [scheduledRun] = await db.select().from(automationRuns).where(eq(automationRuns.automationId,schedule.id));assert(scheduledRun?.eventId);
    const scheduledJob = { protocol: 1 as const,eventId: scheduledRun.eventId,generation: 0 };
    await service.accept({},scheduledJob,1);await service.accept({},scheduledJob,2);
    assert.equal(dispatched.length,1,"queue acceptance dispatches only the stable persisted native input");
    const [mapping] = await db.select().from(automationAgentActions).where(eq(automationAgentActions.runId,scheduledRun.id));assert(mapping?.agentRunId);
    const [execution] = await db.select().from(agentExecutions).where(eq(agentExecutions.runId,mapping.agentRunId));assert(execution);
    assert.equal(execution.status,"accepted","the test accepts a real PG receipt without pretending a Harness turn ran");
    assert.equal(execution.id,dispatched[0].executionId);
    const [thread] = await db.select().from(chatThreads).where(eq(chatThreads.id,mapping.threadId));
    assert.equal(thread.kind,"scheduled_task");assert.equal(thread.userId,owner);
    const [pending] = await db.select().from(automationRuns).where(eq(automationRuns.id,scheduledRun.id));
    assert.equal(pending.status,"running");assert.equal(pending.detail.awaitingNative,true);assert.equal(pending.nextStep,0);
    assert.equal((await db.select().from(rows).where(eq(rows.tableId,target.id))).length,1,"later data actions wait for native completion");
    assert.equal(await service.reconcile({}),0,"active accepted work is not endlessly requeued");

    // A missing checkpoint is intentionally not fabricated by this boundary test.
    await db.update(agentRuns).set({ status: "failed",error: "Fixture interrupted before checkpoint" }).where(eq(agentRuns.id,mapping.agentRunId));
    await db.update(agentExecutions).set({ status: "settled",settledAt: new Date() }).where(eq(agentExecutions.id,execution.id));
    assert.equal(await service.reconcile({}),0);assert.equal(await service.reconcile({}),0);
    assert.equal(dispatched.length,1,"an unknown executed outcome must never dispatch another native turn");
    assert.equal(continuations.length,0);

    const later = await createAutomation(deps,{ ...actor,name: "Known completion after an unknown attempt",source: { kind: "schedule",cron: "* * * * *",timeZone: "UTC" },trigger: { type: "schedule_due" },actions: [
      { type: "run_agent",agentUserId: agentUser,prompt: "A separate scheduled invocation." },
    ] });ruleIds.push(later.id);
    await dispatchDueSchedules(deps,now,25,org);
    const [laterRun] = await db.select().from(automationRuns).where(eq(automationRuns.automationId,later.id));assert(laterRun?.eventId);
    await service.accept({},{ protocol: 1,eventId: laterRun.eventId,generation: 0 },1);
    const [laterMapping] = await db.select().from(automationAgentActions).where(eq(automationAgentActions.runId,laterRun.id));assert(laterMapping.agentRunId);
    // This boundary test seeds the trusted runner's terminal status; actual SDK
    // completion and checkpoint persistence are covered by gateway-process tests.
    await db.update(agentRuns).set({ status: "completed",endedAt: new Date() }).where(eq(agentRuns.id,laterMapping.agentRunId));
    const count = await reconcileNativeAutomations({ ...deps,runAgentAction: async () => { throw new Error("Reconciliation cannot dispatch"); } },1,org);
    assert.equal(count,1,"an earlier unknown attempt cannot consume the bounded reconciliation slot");
    const [ready] = await db.select().from(automationEvents).where(eq(automationEvents.id,laterRun.eventId));
    assert.equal(ready.status,"matched");assert.equal(ready.generation,1);
    const [untouched] = await db.select().from(automationEvents).where(eq(automationEvents.id,scheduledRun.eventId));
    assert.equal(untouched.status,"waiting_input");assert.equal(untouched.generation,0);
    assert.equal(dispatched.length,2,"reconciliation never repeats the interrupted computing attempt");
  } finally {
    if (ruleIds.length) await db.delete(automationRuns).where(inArray(automationRuns.automationId,ruleIds));
    await db.delete(organization).where(eq(organization.id,org));
    await db.delete(user).where(inArray(user.id,[owner,agentUser]));
    await resource.close();
  }
});
