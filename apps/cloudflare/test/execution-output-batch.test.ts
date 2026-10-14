import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq,inArray } from "drizzle-orm";
import type { UIMessageChunk } from "ai";
import { createDatabase } from "@tabdo/backend/database";
import type { CommandDependencies } from "@tabdo/backend/dependencies";
import type { Actor } from "@tabdo/backend/auth/actor";
import { ServiceError } from "@tabdo/backend/errors";
import { user,organization,member,agentProfile,chatThreads,agentExecutions } from "@tabdo/backend/schema";
import { claimRuntimeLease,prepareRuntimeRecord,releaseRuntimeLease } from "@tabdo/backend/agent/runtime-store";
import { beginNativeRun } from "@tabdo/backend/agent/runs";
import { acceptNativeExecution,appendNativeExecutionChunks,loadNativeExecution,readNativeExecutionOutput } from "@tabdo/backend/agent/executions";
import { issueExecutionGateway,handleExecutionGateway,type GatewayServices } from "@tabdo/backend/agent/gateway";
import { createProductGatewayHandler } from "../src/gateway.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("gateway batches atomically reserve continuous cursors, enforce bounds/authority and notify only after commit",async () => {
  const resource = createDatabase({ connectionString: databaseUrl,poolMax: 1 }),db = resource.db;
  const deps: CommandDependencies = { database: db,uuid: randomUUID,now: () => new Date(),automationQueueName: "output-batch-fixture" };
  const org = randomUUID(),owner = randomUUID(),agentUser = randomUUID(),agentMember = randomUUID();
  const actor: Actor = { kind: "human",userId: owner,memberId: owner,organizationId: org,role: "owner",name: "Batch owner",email: `${owner}@local.test` };
  const services: GatewayServices = { prepare: async () => ({ harness: "pi",instructions: "Fixture",skills: [],toolDefinitions: [] }),executeTool: async () => { throw new Error("No tools in this persistence test"); } };
  let lease: Awaited<ReturnType<typeof claimRuntimeLease>> | undefined;
  const chunk = (delta: string): UIMessageChunk => ({ type: "text-delta",id: "fixture-text",delta });
  try {
    await db.insert(user).values([{ id: owner,name: actor.name,email: actor.email },{ id: agentUser,name: "Batch agent",email: `${agentUser}@local.test`,kind: "agent" }]);
    await db.insert(organization).values({ id: org,name: "Batch fixture",slug: org });
    await db.insert(member).values([{ id: owner,userId: owner,organizationId: org,role: "owner" },{ id: agentMember,userId: agentUser,organizationId: org }]);
    const [profile] = await db.insert(agentProfile).values({ userId: agentUser,memberId: agentMember,organizationId: org,displayName: "Batch agent" }).returning();
    const [thread] = await db.insert(chatThreads).values({ userId: owner,organizationId: org,clientId: randomUUID(),custom: { resourceKey: "workspace" } }).returning();
    lease = await claimRuntimeLease(deps,thread.id,actor);
    const record = await prepareRuntimeRecord(deps,lease,actor,{ profileId: profile.id,harness: "pi",mode: "local" });
    const run = await beginNativeRun(deps,lease,actor,record,{ id: randomUUID(),parentId: null,format: "ai-sdk/v6",content: { role: "user",parts: [{ type: "text",text: "Batch fixture" }] } },agentMember);
    const reference = await acceptNativeExecution(deps,{ actor,lease,run,prompt: "Batch fixture",context: { page: "ai" } });
    const credentials = await issueExecutionGateway(deps,reference.executionId,{ launchToken: randomUUID() });
    await handleExecutionGateway(deps,credentials,"bootstrap",{},services);
    await handleExecutionGateway(deps,credentials,"appendBatch",{ chunks: [chunk("A"),chunk("B")] },services);
    await handleExecutionGateway(deps,credentials,"append",{ chunk: chunk("C") },services);
    const loaded = await loadNativeExecution(deps,reference.executionId);
    const output = () => readNativeExecutionOutput(deps,{ executionId: reference.executionId,expected: reference,actor,limit: 100 });
    await assert.rejects(handleExecutionGateway(deps,credentials,"appendBatch",{ chunks: Array.from({ length: 129 },() => chunk("overflow")) },services));
    await assert.rejects(handleExecutionGateway(deps,credentials,"appendBatch",{ chunks: [chunk("x".repeat(1024 * 1024))] },services),error => error instanceof ServiceError && error.status === 413);
    await assert.rejects(db.transaction(async tx => { await appendNativeExecutionChunks(deps,loaded,[chunk("rolled back"),chunk("also rolled back")],tx);throw new Error("Fixture transaction rollback"); }),/Fixture transaction rollback/);
    assert.deepEqual((await output()).events.map(event => event.cursor),[1,2,3],"failed batches roll back both lastCursor and every inserted chunk");
    await Promise.all([
      handleExecutionGateway(deps,credentials,"appendBatch",{ chunks: [chunk("D"),chunk("E")] },services),
      handleExecutionGateway(deps,credentials,"appendBatch",{ chunks: [chunk("F"),chunk("G")] },services),
    ]);
    assert.deepEqual((await output()).events.map(event => event.cursor),[1,2,3,4,5,6,7]);
    const committed: number[] = [],notifications: Promise<unknown>[] = [];
    const gateway = createProductGatewayHandler({ acquire: async () => ({ runtime: deps,commands: deps,identity: { database: db,resolveSession: async () => null },builtins: [],close: async () => {} }),runtimeEnvironment: () => ({}),
      afterChanged: async (_env,id) => {
        const [execution] = await db.select().from(agentExecutions).where(eq(agentExecutions.id,id));committed.push(execution.lastCursor);
      },
    });
    const response = await gateway(new Request("http://fixture/internal/gateway",{ method: "POST",headers: { authorization: `Bearer ${credentials.token}`,"x-tabdo-launch-token": credentials.launchToken,"content-type": "application/json" },body: JSON.stringify({ action: "appendBatch",payload: { chunks: [chunk("H"),chunk("I")] } }) }),{},reference.executionId,{ waitUntil: promise => { notifications.push(promise); } });
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ ok: true });await Promise.all(notifications);assert.deepEqual(committed,[9],"notification observes the full committed batch");
    const replay = await readNativeExecutionOutput(deps,{ executionId: reference.executionId,expected: reference,actor,after: 7,limit: 2 });
    assert.deepEqual(replay.events.map(event => event.cursor),[8,9]);
    await assert.rejects(readNativeExecutionOutput(deps,{ executionId: reference.executionId,expected: { ...reference,threadId: randomUUID() },actor }),error => error instanceof ServiceError && error.status === 404);
    await assert.rejects(handleExecutionGateway(deps,{ ...credentials,token: randomUUID().repeat(3) },"appendBatch",{ chunks: [chunk("forbidden")] },services),error => error instanceof ServiceError && error.status === 401);
    const largeDelta = "L".repeat(1024 * 1024 + 16);
    await handleExecutionGateway(deps,credentials,"append",{ chunk: chunk(largeDelta) },services);
    const largePage = await readNativeExecutionOutput(deps,{ executionId: reference.executionId,expected: reference,actor,after: 9,limit: 1 });
    assert.equal(largePage.events[0]?.cursor,10);
    const largeChunk = largePage.events[0]?.chunk;assert(largeChunk.type === "text-delta");
    assert.equal(largeChunk.delta.length,largeDelta.length,"old single append accepts tool output larger than the new batch limit");
    await db.delete(member).where(eq(member.id,owner));
    await assert.rejects(handleExecutionGateway(deps,credentials,"appendBatch",{ chunks: [chunk("revoked")] },services),error => error instanceof ServiceError && error.status === 404);
    await assert.rejects(output(),error => error instanceof ServiceError && error.status === 404);
    const [final] = await db.select().from(agentExecutions).where(eq(agentExecutions.id,reference.executionId));assert.equal(final.lastCursor,10);
  } finally {
    if (lease) await releaseRuntimeLease(deps,lease);
    await db.delete(organization).where(eq(organization.id,org));
    await db.delete(user).where(inArray(user.id,[owner,agentUser]));
    await resource.close();
  }
});
