import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { asSchema } from "ai";
import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import type { AskUserQuestionsInput, AskUserQuestionsOutput } from "@tabdo/shared";
import { createDatabase } from "../../src/business/db/factory.js";
import { ServiceError } from "../../src/business/errors.js";
import type { Actor } from "../../src/business/auth/actor.js";
import type { QuestionDependencies, PendingQuestionCall } from "../../src/business/agent/questions.js";
import { QUESTION_NOT_INVOKED, resumeQuestionRun } from "../../src/business/agent/questions.js";
import { user, organization, member, agentProfile, chatThreads, chatMessages, agentRuns, agentExecutions } from "../../src/business/db/schema.js";
import { claimRuntimeLease, releaseRuntimeLease, prepareRuntimeRecord, completeRuntimeTurn } from "../../src/business/agent/runtime-store.js";
import { beginNativeRun } from "../../src/business/agent/runs.js";
import { acceptNativeExecution } from "../../src/business/agent/executions.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const rejected = (status: number) => (error: unknown) => error instanceof ServiceError && error.status === status;
async function official<T>(schema: Parameters<typeof asSchema<T>>[0], value: unknown): Promise<T> {
  const result = await asSchema(schema).validate?.(value);
  if (!result?.success) throw new ServiceError(400, { message: "Invalid official schema" });
  return result.value;
}

test("canonical question acceptance consumes startup proof and cannot bypass accepted or uncertain execution", async () => {
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 4 });
  const db = resource.db;
  const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMembership = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Question SQL owner", email: `${owner}@local.test` };
  type Continuation = { pendingToolResults: PendingQuestionCall[] };
  const deps: QuestionDependencies<Continuation> = {
    database: db, now: () => new Date(), uuid: randomUUID,
    validateInput: value => official<AskUserQuestionsInput>(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.inputSchema, value),
    validateOutput: value => official<AskUserQuestionsOutput>(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.outputSchema!, value),
    getContinuation: record => record.resumeState?.continueFrom as Continuation | undefined,
    getPendingCalls: continuation => continuation.pendingToolResults,
  };
  const input: AskUserQuestionsInput = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] };
  const answer: AskUserQuestionsOutput = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
  const continuation: Continuation = { pendingToolResults: [{ toolCallId: "question-1", toolName: "askUserQuestions", input: JSON.stringify(input) }] };
  try {
    await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Question SQL agent", email: `${agentUser}@local.test`, kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "Question SQL fixture", slug: org });
    await db.insert(member).values([{ id: owner, organizationId: org, userId: owner, role: "owner" }, { id: agentMembership, organizationId: org, userId: agentUser }]);
    const [profile] = await db.insert(agentProfile).values({ userId: agentUser, memberId: agentMembership, organizationId: org, displayName: "Question SQL agent" }).returning();
    const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning();
    const initialLease = await claimRuntimeLease(deps, thread.id, actor);
    const initialRecord = await prepareRuntimeRecord(deps, initialLease, actor, { profileId: profile.id, harness: "pi", mode: "local" });
    const userMessageId = randomUUID();
    const run = await beginNativeRun(deps, initialLease, actor, initialRecord, { id: userMessageId, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "Ask my direction" }] } }, agentMembership);
    await completeRuntimeTurn(deps, initialLease, actor, initialRecord.id, {
      resumeState: { specificationVersion: "harness-v1", harnessId: "pi", type: "resume-session", data: { opaque: "preserved" }, continueFrom: continuation },
      workspace: null, sandboxId: initialRecord.sandboxId, status: "ready",
      userMessageId, assistantMessageId: run.assistantMessageId,
    }, { id: run.assistantMessageId, parentId: userMessageId, format: "ai-sdk/v6", content: { role: "assistant", parts: [{ type: "tool-askUserQuestions", toolCallId: "question-1", state: "input-available", input }] } }, { id: run.id, status: "suspended" });
    await releaseRuntimeLease(deps, initialLease);
    const lease = await claimRuntimeLease(deps, thread.id, actor);
    const record = await prepareRuntimeRecord(deps, lease, actor, { profileId: profile.id, harness: "pi", mode: "local" });
    const request = { intent: "tool-result" as const, assistantMessageId: run.assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] };
    const accepted = await resumeQuestionRun(deps, lease, actor, record, request);
    assert.equal(accepted.run.id, run.id);assert.equal(accepted.run.fence, lease.fence);
    assert.deepEqual(accepted.continuation, continuation);assert.equal(accepted.run.status, "running");
    const proof = { proof: QUESTION_NOT_INVOKED, runId: run.id, fence: lease.fence, toolCallIds: ["question-1"] };
    const [stored] = await db.select().from(chatMessages).where(eq(chatMessages.messageId, run.assistantMessageId));
    const withProof = (value = proof) => db.update(chatMessages).set({ content: { ...stored.content, metadata: { keep: "private metadata", nativeQuestionInvocation: value } } }).where(eq(chatMessages.id, stored.id));
    await db.update(agentRuns).set({ status: "failed" }).where(eq(agentRuns.id, run.id));
    await assert.rejects(resumeQuestionRun(deps, lease, actor, record, request), rejected(409), "already committed answer without a startup certificate is not replayable");
    await withProof({ ...proof, fence: lease.fence + 1 });
    await assert.rejects(resumeQuestionRun(deps, lease, actor, record, request), rejected(409), "a stale fence certificate is not replayable");
    await withProof({ ...proof, runId: randomUUID() });
    await assert.rejects(resumeQuestionRun(deps, lease, actor, record, request), rejected(409), "a certificate belongs to one Run only");
    await withProof();
    await assert.rejects(resumeQuestionRun(deps, lease, actor, record, { ...request, toolResults: [{ toolCallId: "question-1", output: { action: "answered", answers: { direction: { optionIds: ["a"] } } } }] }), rejected(409), "accepted answers are immutable even before SDK invocation");
    await db.update(agentRuns).set({ status: "completed" }).where(eq(agentRuns.id, run.id));
    await assert.rejects(resumeQuestionRun(deps, lease, actor, record, request), rejected(409), "a successful terminal Run never becomes active again");
    await db.update(agentRuns).set({ status: "failed" }).where(eq(agentRuns.id, run.id));
    const retried = await resumeQuestionRun(deps, lease, actor, record, request);
    assert.equal(retried.run.id, run.id);
    const [consumed] = await db.select().from(chatMessages).where(eq(chatMessages.id, stored.id));
    assert.deepEqual(consumed.content.metadata, { keep: "private metadata" });
    const reference = await acceptNativeExecution(deps, { actor, lease, run: retried.run, context: { page: "ai" }, prompt: "", toolResultContinuations: retried.toolResultContinuations });
    await releaseRuntimeLease(deps, lease);
    const nextLease = await claimRuntimeLease(deps, thread.id, actor);
    assert(nextLease.fence > lease.fence);
    // An older accepted/invoking fence is still durable ownership. A matching
    // pre-invocation certificate cannot invalidate that dispatch.
    await db.update(agentRuns).set({ status: "failed" }).where(eq(agentRuns.id, run.id));
    await withProof();
    await assert.rejects(resumeQuestionRun(deps, nextLease, actor, record, request), rejected(409), "an older accepted dispatch prevents a new answer acceptance");
    await db.update(agentExecutions).set({ status: "invoking" }).where(eq(agentExecutions.id, reference.executionId));
    await assert.rejects(resumeQuestionRun(deps, nextLease, actor, record, request), rejected(409), "unknown SDK start cannot replay the accepted answer");
    await db.update(agentExecutions).set({ status: "settled" }).where(eq(agentExecutions.id, reference.executionId));
    await db.update(chatMessages).set({ content: consumed.content }).where(eq(chatMessages.id, stored.id));
    await assert.rejects(resumeQuestionRun(deps, nextLease, actor, record, request), rejected(409), "consumed proof is not reused after an uncertain invocation");
    await withProof();
    await db.delete(member).where(eq(member.id, owner));
    await assert.rejects(resumeQuestionRun(deps, nextLease, actor, record, request), rejected(404), "workspace departure denies canonical acceptance");
    const [unchanged] = await db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
    assert.equal(unchanged.status, "failed");assert.equal(unchanged.fence, lease.fence);
    await releaseRuntimeLease(deps, nextLease);
  } finally {
    await db.delete(organization).where(eq(organization.id, org));
    for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id));
    await resource.close();
  }
});
