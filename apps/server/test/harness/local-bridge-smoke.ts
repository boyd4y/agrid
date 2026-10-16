import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { asSchema, type UIMessage, type ToolSet } from "ai";
import { createNativeModelFixture } from "../../../../packages/agent-runtime/test/native-model-fixture.mjs";
import { withPlatformResources } from "../../src/resources/scope.js";
import { createNodeHttpResources } from "../../src/resources/node.js";
import { db, client } from "../../src/db/index.js";
import { user, member, organization, agentProfile, chatThreads, chatMessages, tables, agentRuntimeSessions, agentRuns } from "../../src/db/schema.js";
import { prepareNativeChatAgent } from "../../src/harness/preparation.js";
import { resolveChatContext } from "../../src/chat/context.js";
import { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } from "../../src/harness/store.js";
import { beginNativeRun } from "../../src/harness/runs.js";
import { executeNativeRun } from "../../src/harness/execution.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { assertRuntimeProviderAvailable } from "../../src/business/agent/sandbox-configuration.js";
import type { Actor } from "../../src/auth/actor.js";

assert(new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_agent_test"), "Use an isolated *_agent_test database");
assert.equal(process.env.DATABASE_URL_UNPOOLED, process.env.DATABASE_URL, "Override both database variables");
const providerFlag = process.argv.indexOf("--provider"), harnessFlag = process.argv.indexOf("--harness");
const provider = providerFlag < 0 ? "local" : process.argv[providerFlag + 1];
assert(provider === "local" || provider === "e2b" || provider === "railway", "Pass --provider local|e2b|railway");
const remote = provider !== "local";
if (remote) {
  assert(process.env.HARNESS_REMOTE_SMOKE === "1", "Set HARNESS_REMOTE_SMOKE=1 to create a real test resource");
  assertRuntimeProviderAvailable(provider, process.env);
}
const harness = harnessFlag < 0 ? "pi" : process.argv[harnessFlag + 1];
assert(harness === "codex" || harness === "claude" || harness === "pi", "Pass --harness pi|codex|claude");
const fixture = createNativeModelFixture(harness, "create_table", { name: `Native ${harness} smoke ${randomUUID()}` });
const root = await mkdtemp(join(tmpdir(), "tabdo-0013-platform-"));
const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID();
const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Bridge smoke owner", email: `${owner}@local.test` };
let resources: Awaited<ReturnType<typeof createNodeHttpResources>> | undefined;
let sandboxId: string | undefined;
let passed = false;
try {
  await new Promise<void>(resolve => fixture.model.listen(0, "127.0.0.1", resolve));
  const address = fixture.model.address();assert(address && typeof address !== "string");
  process.env.LOCAL_SANDBOX_DIRECTORY = root;
  process.env.HARNESS_LOCAL_ENABLED = "true";
  process.env.OPENAI_API_KEY = "local-fixture-only";process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.ANTHROPIC_API_KEY = "local-fixture-only";process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.PI_API_KEY = "local-fixture-only";process.env.PI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.PI_MODEL = "local-test";process.env.PI_CONTEXT_WINDOW = "200000";process.env.PI_MAX_OUTPUT_TOKENS = "1024";
  process.env.AI_CHAT_FIRST_CHUNK_MS = "600000";process.env.AI_CHAT_TOTAL_MS = "900000";
  resources = await createNodeHttpResources({ background: false });
  await withPlatformResources(resources, async () => {
    await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Bridge agent", email: `${agentUser}@local.test`, kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "0013 bridge smoke", slug: org });
    await db.insert(member).values([{ id: owner, organizationId: org, userId: owner, role: "owner" }, { id: agentMember, organizationId: org, userId: agentUser }]);
    const [profile] = await db.insert(agentProfile).values({ userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Bridge agent",
      persona: { defaultHarness: harness, runtime: remote ? "sandbox" : "local", ...(remote ? { sandboxProvider: provider } : {}),
        defaultModel: harness === "codex" ? "gpt-5.4" : harness === "claude" ? "claude-sonnet-4-6" : "local-test", skillNames: [] } }).returning();
    const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace", agentId: agentMember } }).returning();
    let resumedRequestStart = 0;
    let firstConfiguration: Record<string, string> | undefined;
    for (let turn = 0; turn < 2; turn++) {
      if (turn === 1) resumedRequestStart = fixture.bodies.length;
      const context = await resolveChatContext({ page: "ai" }, actor);
      const prepared = await prepareNativeChatAgent({ actor, agentId: agentMember, threadId: thread.id, context });
      const configuration = { instructions: prepared.system, agentsDocument: prepared.agentsDocument,
        skills: JSON.stringify(prepared.skills), tools: JSON.stringify(await Promise.all(Object.entries(prepared.tools as ToolSet).map(async ([name, definition]) => ({
          name, description: definition.description, schema: await asSchema(definition.inputSchema).jsonSchema,
        })))), disabledTools: JSON.stringify(prepared.disabledTools) };
      if (firstConfiguration) console.log("[platform-smoke] changed public configuration fields", Object.keys(configuration).filter(key => configuration[key as keyof typeof configuration] !== firstConfiguration![key]));
      else firstConfiguration = configuration;
      const lease = await claimRuntimeLease(thread.id, actor);
      try {
        const record = await prepareRuntimeRecord(lease, actor, { profileId: profile.id, harness, mode: prepared.mode, provider: prepared.provider });
        const prompt = turn === 0 ? "Create the fixture table once." : "Recall the previous result without creating another table.";
        const message: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] };
        const run = await beginNativeRun(lease, actor, record, { id: message.id, parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: message.parts } }, agentMember);
        console.log(`[platform-smoke] ${provider}/${harness} official Run ${turn + 1} starting`);
        await executeNativeRun({ actor, lease, record, run, harness, modelId: prepared.modelId, piModel: prepared.piModel, instructions: prepared.system,
          agentsDocument: prepared.agentsDocument, tools: prepared.tools, disabledTools: prepared.disabledTools, skills: prepared.skills, prompt, messages: [message], metadata: {} });
        const [saved] = await db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
        assert.equal(saved.status, "completed", saved.error ?? "Run did not complete");
        const [reply] = await db.select().from(chatMessages).where(eq(chatMessages.messageId, run.assistantMessageId));
        assert(JSON.stringify(reply?.content).includes(turn === 0 ? fixture.firstReply : fixture.secondReply), "the completed Run persists its actual assistant reply");
        const [runtime] = await db.select().from(agentRuntimeSessions).where(eq(agentRuntimeSessions.id, record.id));
        assert.equal(runtime.provider, provider);assert.equal(runtime.sandboxCreated, true);assert(runtime.resumeState);
        if (sandboxId) assert.equal(runtime.sandboxId, sandboxId, "a fresh Run reconnects the same provider resource");
        else {
          sandboxId = runtime.sandboxId;
          if (remote) assert.notEqual(sandboxId, record.sandboxId, "the actual provider ID replaces the unallocated logical reservation");
          console.log(`[platform-smoke] bound ${provider} test Sandbox ${sandboxId}`);
        }
        assert.equal((await db.select().from(tables).where(eq(tables.organizationId, org))).length, 1, "real scoped table command commits once across resumed Runs");
        fixture.nextTurn();
      } finally { await releaseRuntimeLease(lease); }
    }
    const resumedRequests = fixture.bodies.slice(resumedRequestStart);
    console.log("[platform-smoke] resumed model requests", JSON.stringify(resumedRequests.map(value => {
      const body = value as Record<string, unknown>;
      return { keys: Object.keys(body), previousResponseId: body.previous_response_id, hasFirstReply: JSON.stringify(body).includes(fixture.firstReply),
        inputCount: Array.isArray(body.input) ? body.input.length : undefined, messageCount: Array.isArray(body.messages) ? body.messages.length : undefined };
    })));
    assert(resumedRequests.some(body => JSON.stringify(body).includes(fixture.firstReply)), "a resumed native model request must include prior output");
    assert.deepEqual(fixture.errors, []);
    passed = true;
  });
} catch (error) {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
  for (const key of ["E2B_API_KEY", "RAILWAY_API_TOKEN"]) if (process.env[key]) message = message.replaceAll(process.env[key]!, "[redacted]");
  console.error(`[platform-smoke] FAIL ${provider}/${harness}: ${message}`);process.exitCode = 1;
}
finally {
  if (resources) await withPlatformResources(resources, async () => {
    let cleanupFailed = false;
    if (remote) {
      const records = await db.select().from(agentRuntimeSessions).innerJoin(chatThreads, eq(chatThreads.id, agentRuntimeSessions.threadId)).where(eq(chatThreads.organizationId, org));
      for (const { agent_runtime_sessions: record } of records) {
        if (!record.sandboxCreated) continue;
        try {
          assert.equal(record.provider, provider);
          const agent = createNativeAgent({ harness, mode: "sandbox", provider, modelId: "local-test", instructions: "Cleanup only; no model turn.", tools: {}, skills: [] });
          const opened = await openNativeSandbox({ agent, mode: "sandbox", provider, sandboxId: record.sandboxId, hasResumeState: true, signal: AbortSignal.timeout(30_000) });
          await opened.sandbox.destroy();
          console.log(`[platform-smoke] destroyed owned ${provider} test Sandbox ${record.sandboxId}`);
        } catch {
          cleanupFailed = true;process.exitCode = 1;
          console.error(`[platform-smoke] cleanup failed; preserve fixture org ${org} and test Sandbox ${record.sandboxId} for lead recovery`);
        }
      }
    }
    if (!cleanupFailed) { await db.delete(organization).where(eq(organization.id, org));await db.delete(user).where(inArray(user.id, [owner, agentUser])); }
  });
  fixture.model.closeAllConnections();await new Promise<void>(resolve => fixture.model.close(() => resolve()));
  await client.end();await rm(root, { recursive: true, force: true });
}
if (passed && !process.exitCode) console.log(`[platform-smoke] PASS ${provider}/${harness}: actual admission, permissions, table command, lease/Run, provider/actual ID, opaque checkpoint, same-ID reconnect, official native history, no duplicate table; owned test resources cleaned`);
