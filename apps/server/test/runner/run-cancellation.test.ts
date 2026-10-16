import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../src/business/db/factory.js";
import type { RuntimeDependencies } from "../../src/business/dependencies.js";
import type { Actor } from "../../src/business/auth/actor.js";
import { ServiceError } from "../../src/business/errors.js";
import { user, organization, member, agentProfile, chatThreads, agentRuns, agentRuntimeSessions } from "../../src/business/db/schema.js";
import { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } from "../../src/business/agent/runtime-store.js";
import { beginNativeRun, failNativeRun, listNativeRuns, requestRunCancellation } from "../../src/business/agent/runs.js";
import { loadMessages } from "../../src/business/chat/store.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const conflict = (error: unknown) => error instanceof ServiceError && error.status === 409;

test("checkpoint failures preserve durable cancellation without certifying an uninvoked or resumable turn", async t => {
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 4 });
  const db = resource.db;
  const deps: RuntimeDependencies = { database: db, now: () => new Date(), uuid: randomUUID };
  const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Cancellation fixture", email: `${owner}@local.test` };
  const checkpointError = "Fixture checkpoint unavailable";
  try {
    await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Cancellation agent", email: `${agentUser}@local.test`, kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "Cancellation fixture", slug: org });
    await db.insert(member).values([{ id: owner, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
    const [profile] = await db.insert(agentProfile).values({ userId: agentUser, memberId: agentMember, organizationId: org, displayName: "Cancellation agent" }).returning();
    for (const harness of ["pi", "codex", "claude-code"]) {
      for (const cancelled of [false, true]) await t.test(`${harness}: ${cancelled ? "cancelled" : "failed"} with no usable checkpoint`, async () => {
        const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID() }).returning();
        const lease = await claimRuntimeLease(deps, thread.id, actor);
        try {
          const record = await prepareRuntimeRecord(deps, lease, actor, { profileId: profile.id, harness, mode: "local" });
          const run = await beginNativeRun(deps, lease, actor, record, { id: randomUUID(), parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Accepted SDK invocation" }] } }, agentMember);
          if (cancelled) await requestRunCancellation(deps, thread.id, run.id, actor);
          // The failure path must still obey the existing owner/fence transaction.
          await assert.rejects(failNativeRun(deps, { ...lease, token: randomUUID() }, run.id, checkpointError), conflict);
          assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.id, run.id)))[0].endedAt, null);
          await failNativeRun(deps, lease, run.id, checkpointError);
          const [saved] = await listNativeRuns(deps, thread.id, actor);
          assert.equal(saved.status, cancelled ? "cancelled" : "failed");
          assert.equal(Boolean(saved.cancelRequestedAt), cancelled); assert(saved.endedAt);
          assert.equal(saved.error, checkpointError); assert.equal(saved.canContinue, false);
          const [runtime] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, record.id));
          assert.equal(runtime.status, "failed"); assert.equal(runtime.error, checkpointError);
          assert.equal(runtime.resumeState, null); assert.equal(runtime.workspace, null);
          assert.equal(runtime.lastUserMessageId, null); assert.equal(runtime.lastAssistantMessageId, null);
          const history = await loadMessages(deps, thread.id, actor);
          assert.equal(history.messages.length, 1); assert.equal(history.messages[0].content.role, "user", "failure must not invent a retry proof or native assistant result");
          await assert.rejects(beginNativeRun(deps, lease, actor, runtime, { id: randomUUID(), parentId: run.userMessageId, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Do not replay unknown work" }] } }, agentMember), conflict);
        } finally { await releaseRuntimeLease(deps, lease); }
      });
    }
  } finally {
    await db.delete(organization).where(eq(organization.id, org));
    await db.delete(user).where(inArray(user.id, [owner, agentUser]));
    await resource.close();
  }
});
