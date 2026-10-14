import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { ServiceError } from "@tabdo/backend/errors";
import type { RuntimeDependencies } from "@tabdo/backend/dependencies";
import type { Actor } from "@tabdo/backend/auth/actor";
import { user, organization, member, agentProfile, chatThreads } from "@tabdo/backend/schema";
import { claimRuntimeLease, releaseRuntimeLease, renewRuntimeLease, prepareRuntimeRecord } from "@tabdo/backend/agent/runtime-store";
import { beginNativeRun, listNativeRuns, requestRunCancellation, runCancellationRequested } from "@tabdo/backend/agent/runs";
import { acceptNativeExecution, recoverAcceptedNativeExecution, claimNativeExecution, appendNativeExecutionChunk, readNativeExecutionOutput, settleNativeExecution } from "@tabdo/backend/agent/executions";
import { requireThread, loadMessages } from "@tabdo/backend/chat/store";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const status = (code: number) => (error: unknown) => error instanceof ServiceError && error.status === code;

test("Run/lease/receipt services operate without resource scope and preserve durable acceptance and fences", async () => {
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 4 });
  const db = resource.db;
  const fixedTime = new Date("2026-10-15T08:00:00.000Z");
  const deps: RuntimeDependencies = { database: db, now: () => fixedTime, uuid: randomUUID };
  const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMembership = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Explicit Run owner", email: `${owner}@local.test` };
  try {
    await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Explicit agent", email: `${agentUser}@local.test`, kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "Explicit Run fixture", slug: org });
    await db.insert(member).values([{ id: owner, organizationId: org, userId: owner, role: "owner" }, { id: agentMembership, organizationId: org, userId: agentUser }]);
    const [profile] = await db.insert(agentProfile).values({ userId: agentUser, memberId: agentMembership, organizationId: org, displayName: "Explicit agent" }).returning();
    const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning();
    await assert.rejects(requireThread(deps, thread.id, { ...actor, userId: randomUUID() }), status(404));
    const lease = await claimRuntimeLease(deps, thread.id, actor);
    assert(await renewRuntimeLease(deps, lease));
    await assert.rejects(claimRuntimeLease(deps, thread.id, actor), status(409));
    const record = await prepareRuntimeRecord(deps, lease, actor, { profileId: profile.id, harness: "pi", mode: "local" });
    const messageId = randomUUID();
    const run = await beginNativeRun(deps, lease, actor, record, { id: messageId, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Explicit accepted input" }] } }, agentMembership);
    const reference = await acceptNativeExecution(deps, { actor, lease, run, context: { page: "ai" }, prompt: "Explicit accepted input" });
    assert.deepEqual(await acceptNativeExecution(deps, { actor, lease, run, context: { page: "ai" }, prompt: "Explicit accepted input" }), reference);
    await assert.rejects(acceptNativeExecution(deps, { actor, lease, run, context: { page: "ai" }, prompt: "Different accepted input" }), status(409));
    await releaseRuntimeLease(deps, lease);
    assert.equal((await listNativeRuns(deps, thread.id, actor))[0].status, "starting", "durably accepted work survives coordinator release");
    const recovered = await recoverAcceptedNativeExecution(deps, reference.executionId);
    assert(recovered.lease.fence > lease.fence);
    assert(await claimNativeExecution(deps, recovered));
    assert.equal(await claimNativeExecution(deps, recovered), false, "invocation CAS prevents duplicate SDK entry");
    await appendNativeExecutionChunk(deps, recovered, { type: "start", messageId: run.assistantMessageId });
    await Promise.all([
      appendNativeExecutionChunk(deps, recovered, { type: "text-start", id: "fixture" }),
      appendNativeExecutionChunk(deps, recovered, { type: "text-delta", id: "fixture", delta: "Cursor fixture" }),
    ]);
    const page = await readNativeExecutionOutput(deps, { executionId: reference.executionId, actor, expected: reference, limit: 500 });
    assert.deepEqual(page.events.map(event => event.cursor), [1, 2, 3]);assert.equal(page.terminal, false);
    await assert.rejects(readNativeExecutionOutput(deps, { executionId: reference.executionId, actor, expected: { ...reference, runId: randomUUID() } }), status(404));
    await requestRunCancellation(deps, thread.id, run.id, actor);
    assert(await runCancellationRequested(deps, run.id));
    await db.delete(member).where(eq(member.id, owner));
    await assert.rejects(requestRunCancellation(deps, thread.id, run.id, actor), status(404));
    await assert.rejects(readNativeExecutionOutput(deps, { executionId: reference.executionId, actor }), status(404));
    await db.insert(member).values({ id: owner, organizationId: org, userId: owner, role: "owner" });
    await settleNativeExecution(deps, reference.executionId);
    assert((await readNativeExecutionOutput(deps, { executionId: reference.executionId, actor, limit: 500 })).terminal);
    await releaseRuntimeLease(deps, recovered.lease);
    const newLease = await claimRuntimeLease(deps, thread.id, actor);
    await assert.rejects(appendNativeExecutionChunk(deps, recovered, { type: "finish" }), status(409), "stale owner cannot append after the new lease fence");
    await releaseRuntimeLease(deps, newLease);
    assert.equal((await loadMessages(deps, thread.id, actor)).messages.length, 1, "SQL acceptance never fabricates native assistant results");
  } finally {
    await db.delete(organization).where(eq(organization.id, org));
    for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id));
    await resource.close();
  }
});
