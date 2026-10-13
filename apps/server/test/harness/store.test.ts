import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Actor } from "../../src/auth/actor.js";

if (!process.env.DATABASE_URL?.endsWith("_agent_test"))
  throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const {
  user,
  organization,
  member,
  agentProfile,
  chatThreads,
  chatMessages,
  agentThreadLeases,
  agentRuntimeSessions,
} = await import("../../src/db/schema.js");
const { saveMessage } = await import("../../src/chat/store.js");
const { beginNativeRun, listNativeRuns } = await import("../../src/harness/runs.js");
const {
  claimRuntimeLease,
  releaseRuntimeLease,
  renewRuntimeLease,
  withRuntimeLease,
  prepareRuntimeRecord,
  completeRuntimeTurn,
} = await import("../../src/harness/store.js");

const org = randomUUID(),
  foreignOrg = randomUUID(),
  owner = randomUUID(),
  agentUser = randomUUID(),
  agentMember = randomUUID(),
  profileId = randomUUID();
const actor: Actor = {
  kind: "human",
  userId: owner,
  organizationId: org,
  memberId: "fixture",
  role: "owner",
  name: "Runtime test",
  email: `${owner}@local.test`,
};
async function newThread() {
  const [thread] = await db
    .insert(chatThreads)
    .values({
      userId: owner,
      organizationId: org,
      clientId: randomUUID(),
      custom: { resourceKey: "workspace" },
    })
    .returning();
  return thread.id;
}
before(async () => {
  await db.insert(user).values([
    { id: owner, email: actor.email, name: actor.name },
    {
      id: agentUser,
      email: `${agentUser}@local.test`,
      name: "Runtime agent",
      kind: "agent",
    },
  ]);
  await db.insert(organization).values([
    { id: org, name: "Runtime", slug: org },
    { id: foreignOrg, name: "Foreign", slug: foreignOrg },
  ]);
  await db
    .insert(member)
    .values({ id: agentMember, userId: agentUser, organizationId: org });
  await db
    .insert(agentProfile)
    .values({
      id: profileId,
      userId: agentUser,
      organizationId: org,
      memberId: agentMember,
      displayName: "Runtime agent",
    });
});
after(async () => {
  for (const id of [org, foreignOrg])
    await db.delete(organization).where(eq(organization.id, id));
  for (const id of [owner, agentUser])
    await db.delete(user).where(eq(user.id, id));
  await client.end();
});

test("twenty concurrent replicas claim exactly one owner; released ownership is reusable", async () => {
  const threadId = await newThread();
  const claims = await Promise.allSettled(
    Array.from({ length: 20 }, () => claimRuntimeLease(threadId, actor)),
  );
  const winners = claims.filter((r) => r.status === "fulfilled");
  assert.equal(winners.length, 1);
  for (const result of claims)
    if (result.status === "rejected") assert.equal(result.reason.status, 409);
  const lease = winners[0].value;
  assert.equal(await renewRuntimeLease(lease), true);
  await releaseRuntimeLease(lease);
  const next = await claimRuntimeLease(threadId, actor);
  assert(next.fence > lease.fence);
  await releaseRuntimeLease(next);
});

test("expired owners cannot renew, mutate, checkpoint or release a newer owner", async () => {
  const threadId = await newThread();
  const stale = await claimRuntimeLease(threadId, actor);
  await db
    .update(agentThreadLeases)
    .set({ expiresAt: sql`clock_timestamp()-interval '1 second'` })
    .where(eq(agentThreadLeases.threadId, threadId));
  assert.equal(await renewRuntimeLease(stale), false);
  const current = await claimRuntimeLease(threadId, actor);
  let mutation = false;
  await assert.rejects(
    withRuntimeLease(stale, async () => {
      mutation = true;
    }),
    /接管/,
  );
  assert.equal(mutation, false);
  await releaseRuntimeLease(stale);
  assert.equal(await renewRuntimeLease(current), true);
  await releaseRuntimeLease(current);
});

test("host mutation holds the lease row until commit; another replica cannot pass a stale idle check", async () => {
  const threadId = await newThread();
  const lease = await claimRuntimeLease(threadId, actor);
  let entered!: () => void, finish!: () => void;
  const inMutation = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releaseMutation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const protectedMutation = withRuntimeLease(lease, async (tx) => {
    // Simulate expiry during a long host operation without waiting two minutes.
    await tx
      .update(agentThreadLeases)
      .set({ expiresAt: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(agentThreadLeases.threadId, threadId));
    entered();
    await releaseMutation;
    await tx
      .update(chatThreads)
      .set({ title: "committed mutation" })
      .where(eq(chatThreads.id, threadId));
  });
  await inMutation;
  const takeover = claimRuntimeLease(threadId, actor);
  // Ensure the database has actually reached the conflicting UPSERT, without a timing-based test.
  try {
    let blocked = false;
    for (let i = 0; i < 50; i++) {
      const locks = await db.execute(
        sql`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%INSERT INTO agent_thread_leases%'`,
      );
      if (locks.length) {
        blocked = true;
        break;
      }
    }
    assert(blocked, "competing claim waits on the protected row");
  } finally {
    finish();
  }
  await protectedMutation;
  const current = await takeover;
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId));
  assert.equal(thread.title, "committed mutation");
  assert(current.fence > lease.fence);
  await releaseRuntimeLease(current);
});

test("native record is tenant/private scoped and environment changes require a new conversation", async () => {
  const threadId = await newThread();
  await assert.rejects(
    claimRuntimeLease(threadId, { ...actor, organizationId: foreignOrg }),
    /不存在/,
  );
  await assert.rejects(
    claimRuntimeLease(threadId, { ...actor, userId: agentUser }),
    /不存在/,
  );
  const lease = await claimRuntimeLease(threadId, actor);
  await assert.rejects(
    prepareRuntimeRecord(lease, actor, {
      profileId: randomUUID(),
      harness: "pi",
      mode: "local",
    }),
    /不存在/,
  );
  const record = await prepareRuntimeRecord(lease, actor, {
    profileId,
    harness: "pi",
    mode: "local",
  });
  const again = await prepareRuntimeRecord(lease, actor, {
    profileId,
    harness: "pi",
    mode: "local",
  });
  assert.equal(record.id, again.id);
  await assert.rejects(
    prepareRuntimeRecord(lease, actor, {
      profileId,
      harness: "pi",
      mode: "sandbox",
    }),
    /新建对话/,
  );
  await releaseRuntimeLease(lease);
});

test("assistant UI message and opaque native checkpoint commit or roll back together", async () => {
  const threadId = await newThread(),
    lease = await claimRuntimeLease(threadId, actor);
  const record = await prepareRuntimeRecord(lease, actor, {
    profileId,
    harness: "pi",
    mode: "local",
  });
  await saveMessage(threadId, actor, {
    id: "user",
    parentId: null,
    format: "ai-sdk/v6",
    content: { role: "user", parts: [{ type: "text", text: "run" }] },
  });
  const checkpoint = {
    resumeState: {
      specificationVersion: "harness-v1" as const,
      harnessId: "pi",
      type: "resume-session" as const,
      data: { opaque: "native-session" },
    },
    workspace: [],
    sandboxId: record.sandboxId,
    userMessageId: "user",
    assistantMessageId: "assistant",
    status: "ready" as const,
  };
  const message = {
    id: "assistant",
    parentId: "user",
    format: "ai-sdk/v6",
    content: { role: "assistant", parts: [{ type: "text", text: "done" }] },
  };
  await assert.rejects(
    completeRuntimeTurn(lease, actor, randomUUID(), checkpoint, message),
    /会话不存在/,
  );
  assert.equal(
    (
      await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.threadId, threadId))
    ).length,
    1,
  );
  await completeRuntimeTurn(lease, actor, record.id, checkpoint, message);
  const [saved] = await db
    .select()
    .from(agentRuntimeSessions)
    .where(eq(agentRuntimeSessions.id, record.id));
  assert.deepEqual(saved.resumeState, checkpoint.resumeState);
  assert.equal(saved.lastAssistantMessageId, "assistant");
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId));
  assert.equal(messages.length, 2);
  assert.equal(
    messages.find((m) => m.messageId === "assistant")?.serverFinal,
    true,
  );
  await releaseRuntimeLease(lease);
});

test("expired runs become visible failures; an older checkpoint cannot replay an uncommitted turn", async () => {
  const threadId = await newThread(), lease = await claimRuntimeLease(threadId, actor);
  let record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
  const first = await beginNativeRun(lease, actor, record, { id: "run-user-1", parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "first" }] } }, agentMember);
  await completeRuntimeTurn(lease, actor, record.id, {
    resumeState: { type: "resume-session", specificationVersion: "harness-v1", harnessId: "pi", data: { opaque: "fixture" } },
    workspace: [], sandboxId: record.sandboxId, userMessageId: first.userMessageId, assistantMessageId: first.assistantMessageId, status: "ready",
  }, { id: first.assistantMessageId, parentId: first.userMessageId, format: "ai-sdk/v6", content: { role: "assistant", parts: [{ type: "text", text: "first completed" }] } }, { id: first.id, status: "completed" });
  record = await prepareRuntimeRecord(lease, actor, { profileId, harness: "pi", mode: "local" });
  const second = await beginNativeRun(lease, actor, record, { id: "run-user-2", parentId: first.assistantMessageId, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "crashed after mutation" }] } }, agentMember);
  await db.update(agentThreadLeases).set({ expiresAt: sql`clock_timestamp()-interval '1 second'` }).where(eq(agentThreadLeases.threadId, threadId));
  await assert.rejects(listNativeRuns(threadId, { ...actor, organizationId: foreignOrg }), /不存在/);
  const observed = await listNativeRuns(threadId, actor);
  const failed = observed.find((r) => r.id === second.id);
  assert.equal(failed?.status, "failed"); assert.match(failed?.error ?? "", /执行进程已中断/); assert(failed?.endedAt);
  assert.equal(observed.find((r) => r.id === first.id)?.status, "completed");
  const next = await claimRuntimeLease(threadId, actor);
  record = await prepareRuntimeRecord(next, actor, { profileId, harness: "pi", mode: "local" });
  await assert.rejects(beginNativeRun(next, actor, record, { id: "run-user-3", parentId: first.assistantMessageId, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "retry" }] } }, agentMember), /执行因服务中断/);
  assert.equal((await listNativeRuns(threadId, actor)).length, 2);
  await releaseRuntimeLease(next);
});
