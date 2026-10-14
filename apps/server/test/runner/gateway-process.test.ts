import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "@tabdo/backend/database";
import { ServiceError } from "@tabdo/backend/errors";
import type { Actor } from "@tabdo/backend/auth/actor";
import type { CommandDependencies } from "@tabdo/backend/dependencies";
import { user, organization, member, agentProfile, chatThreads, tables, agentRuns, agentExecutions } from "@tabdo/backend/schema";
import { claimRuntimeLease, releaseRuntimeLease, prepareRuntimeRecord } from "@tabdo/backend/agent/runtime-store";
import { beginNativeRun, requestRunCancellation } from "@tabdo/backend/agent/runs";
import { acceptNativeExecution, loadNativeExecution, readNativeExecutionOutput } from "@tabdo/backend/agent/executions";
import { issueExecutionGateway, handleExecutionGateway, type GatewayServices } from "@tabdo/backend/agent/gateway";
import type { GatewayAction, GatewayActions } from "@tabdo/backend/agent/gateway-contracts";
import { resumeQuestionRun } from "@tabdo/backend/agent/questions";
import type { AskUserQuestionsInput, AskUserQuestionsOutput } from "@tabdo/shared";

// This probe deliberately crosses application build roots at runtime. Each app
// separately typechecks its own composition; the shared contract is authoritative.
const { prepareProductExecution, executeProductTool } = await import(new URL("../../../cloudflare/src/agent-preparation.ts", import.meta.url).href) as {
  prepareProductExecution(scope: unknown, env: Record<string, string>, loaded: Parameters<GatewayServices["prepare"]>[0]): ReturnType<GatewayServices["prepare"]>;
  executeProductTool(scope: unknown, input: Parameters<GatewayServices["executeTool"]>[0]): ReturnType<GatewayServices["executeTool"]>;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");

test("credential-limited native processes use a poolMax1 PG gateway for tools, cold questions, output and cancellation", { timeout: 35_000 }, async () => {
  const resource = createDatabase({ connectionString: databaseUrl, poolMax: 1 });
  const db = resource.db;
  const deps: CommandDependencies = { database: db, uuid: randomUUID, now: () => new Date(), automationQueueName: "gateway-fixture" };
  const org = randomUUID(), owner = randomUUID(), agentUser = randomUUID(), agentMember = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Gateway owner", email: `${owner}@local.test` };
  const tableName = `gateway-${randomUUID()}`;
  const question: AskUserQuestionsInput = { allowPartialAnswers: false, questions: [{ id: "direction", question: "Which direction?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], allowFreeForm: true }] };
  const answer: AskUserQuestionsOutput = { action: "answered", answers: { direction: { optionIds: ["b"] } } };
  const requests: { messages: { role: string; tool_call_id?: string; content: unknown }[] }[] = [];
  const scope = { runtime: deps, commands: deps, identity: { database: db, resolveSession: async () => null }, builtins: [], close: async () => {} };
  const executionEnv: Record<string, string> = { PI_API_KEY: "fixture", PI_MODEL: "fixture", PI_CONTEXT_WINDOW: "262144", PI_MAX_OUTPUT_TOKENS: "1024" };
  let toolExecutions = 0;
  const services: GatewayServices = {
    prepare: loaded => prepareProductExecution(scope, executionEnv, loaded),
    executeTool: async input => {
      assert.equal(input.name, "create_table");
      toolExecutions++;
      return executeProductTool(scope, input);
    },
  };
  const provider = createServer(async (request, response) => {
    let raw = "";for await (const bytes of request) raw += bytes;requests.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "gateway-fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (requests.length <= 2) {
      const first = requests.length === 1;
      send({ role: "assistant", tool_calls: [{ index: 0, id: first ? "table-1" : "question-1", type: "function", function: { name: first ? "create_table" : "askUserQuestions", arguments: JSON.stringify(first ? { name: tableName } : question) } }] });send({}, "tool_calls");
    } else { send({ role: "assistant", content: "Native answer B, no replay." });send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  const gateway = createServer(async (request, response) => {
    try {
      let raw = "";for await (const bytes of request) { raw += bytes;if (Buffer.byteLength(raw) > 48 * 1024 * 1024) throw new ServiceError(413, { message: "Too large" }); }
      const body = JSON.parse(raw) as { action: GatewayAction; payload: GatewayActions[GatewayAction]["input"] };
      const credentials = { executionId: request.url!.slice(1), token: request.headers.authorization?.replace(/^Bearer /, "") ?? "", launchToken: request.headers["x-tabdo-launch-token"] as string };
      const result = await handleExecutionGateway(deps, credentials, body.action, body.payload, services);
      if (body.action === "tool") {
        const payload = body.payload as GatewayActions["tool"]["input"];
        assert.deepEqual(await handleExecutionGateway(deps, credentials, body.action, payload, services), result, "a lost HTTP acknowledgement returns the durable result without a second command");
        await assert.rejects(handleExecutionGateway(deps, credentials, "tool", { ...payload, input: { name: `${tableName}-changed` } }, services), error => error instanceof ServiceError && error.status === 409);
      }
      response.writeHead(200, { "content-type": "application/json" });response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(error instanceof ServiceError ? error.status : 500, { "content-type": "application/json" });response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Gateway failure" }));
    }
  });
  await Promise.all([new Promise<void>(done => provider.listen(0, "127.0.0.1", done)), new Promise<void>(done => gateway.listen(0, "127.0.0.1", done))]);
  const providerPort = (provider.address() as { port: number }).port;
  executionEnv.PI_BASE_URL = `http://127.0.0.1:${providerPort}/v1`;
  const gatewayPort = (gateway.address() as { port: number }).port;
  const runChild = async (input: unknown, validate = false) => {
    const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", "../cloudflare/sandbox/runtime/entry.ts", ...(validate ? ["--validate-questions"] : [])], {
      cwd: resolve(import.meta.dirname, "../.."), stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, TSX_TSCONFIG_PATH: resolve(import.meta.dirname, "../../../cloudflare/sandbox/runtime/tsconfig.runtime.json"), NODE_ENV: "test", PI_API_KEY: "fixture", PI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, PI_MODEL: "fixture", AI_CHAT_TOTAL_MS: "15_000", AI_RUN_POLL_MS: "200" },
    });
    let stdout = "", stderr = "";child.stdout.on("data", bytes => stdout += bytes);child.stderr.on("data", bytes => stderr += bytes);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise<number | null>((done, reject) => { child.once("error", reject);child.once("exit", done); });
    clearTimeout(timeout);assert.equal(code, 0, stderr);return stdout;
  };
  const launch = async (executionId: string) => {
    const credentials = await issueExecutionGateway(deps, executionId, { launchToken: randomUUID() });
    return { executionId, token: credentials.token, launchToken: credentials.launchToken, gatewayUrl: `http://127.0.0.1:${gatewayPort}/${executionId}` };
  };
  try {
    await db.insert(user).values([{ id: owner, name: actor.name, email: actor.email }, { id: agentUser, name: "Gateway agent", email: `${agentUser}@local.test`, kind: "agent" }]);
    await db.insert(organization).values({ id: org, name: "Gateway fixture", slug: org });
    await db.insert(member).values([{ id: owner, userId: owner, organizationId: org, role: "owner" }, { id: agentMember, userId: agentUser, organizationId: org }]);
    const [profile] = await db.insert(agentProfile).values({ userId: agentUser, organizationId: org, memberId: agentMember, displayName: "Gateway agent", persona: { defaultHarness: "pi", defaultModel: "fixture", runtime: "local", skillNames: [] } }).returning();
    const createAccepted = async (prompt: string) => {
      const [thread] = await db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: { resourceKey: "workspace" } }).returning();
      const lease = await claimRuntimeLease(deps, thread.id, actor), record = await prepareRuntimeRecord(deps, lease, actor, { profileId: profile.id, harness: "pi", mode: "local" });
      const run = await beginNativeRun(deps, lease, actor, record, { id: randomUUID(), parentId: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: prompt }] } }, agentMember);
      const reference = await acceptNativeExecution(deps, { actor, lease, run, prompt, context: { page: "ai" } });
      await releaseRuntimeLease(deps, lease);return { thread, run, reference };
    };
    const first = await createAccepted("Create one table then ask direction.");
    const firstLaunch = await launch(first.reference.executionId);
    await assert.rejects(handleExecutionGateway(deps, { ...firstLaunch, launchToken: randomUUID() }, "bootstrap", {}, services), error => error instanceof ServiceError && error.status === 401);
    await runChild(firstLaunch);
    const pending = await loadNativeExecution(deps, first.reference.executionId);
    assert.equal(pending.run.status, "suspended");assert.equal(pending.execution.status, "settled");assert(pending.record.resumeState?.continueFrom);
    assert.equal(toolExecutions, 1);assert.equal(requests.length, 2);
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, tableName)))).length, 1);
    const output = await readNativeExecutionOutput(deps, { executionId: first.reference.executionId, actor, limit: 500 });
    assert(output.terminal);assert(output.events.some(event => event.chunk.type === "tool-input-available"));
    await assert.rejects(issueExecutionGateway(deps, first.reference.executionId, { launchToken: randomUUID() }), error => error instanceof ServiceError && error.status === 409);
    const validated = JSON.parse(await runChild({ pairs: [{ input: question, output: answer }] }, true));
    assert.deepEqual(validated, { pairs: [{ input: question, output: answer }] });
    const answerLease = await claimRuntimeLease(deps, first.thread.id, actor), answerRecord = await prepareRuntimeRecord(deps, answerLease, actor, { profileId: profile.id, harness: "pi", mode: "local" });
    const resumed = await resumeQuestionRun({ ...deps,
      validateInput: async () => validated.pairs[0].input,
      validateOutput: async () => validated.pairs[0].output,
      getContinuation: record => record.resumeState?.continueFrom as { pendingToolResults: { toolCallId: string; toolName: string; input: string }[] }, getPendingCalls: continuation => continuation.pendingToolResults,
    }, answerLease, actor, answerRecord, { intent: "tool-result", assistantMessageId: first.run.assistantMessageId, toolResults: [{ toolCallId: "question-1", output: answer }] });
    const second = await acceptNativeExecution(deps, { actor, lease: answerLease, run: resumed.run, prompt: "", context: { page: "ai" }, toolResultContinuations: resumed.toolResultContinuations });
    await releaseRuntimeLease(deps, answerLease);
    await runChild(await launch(second.executionId));
    assert.equal(requests.length, 3);assert.equal(toolExecutions, 1);
    const completed = await loadNativeExecution(deps, second.executionId);assert.equal(completed.run.status, "completed");assert.equal(completed.run.id, first.run.id);
    assert.equal(requests[2].messages.filter(message => message.role === "user").length, 1);
    assert.deepEqual(JSON.parse(requests[2].messages.find(message => message.tool_call_id === "question-1")!.content as string), answer);
    const authority = await createAccepted("Probe atomic gateway boundaries");
    const obsolete = await launch(authority.reference.executionId), current = await launch(authority.reference.executionId);
    await assert.rejects(handleExecutionGateway(deps, obsolete, "bootstrap", {}, services), error => error instanceof ServiceError && error.status === 401, "a rotated launch capability cannot claim the SDK");
    await handleExecutionGateway(deps, current, "bootstrap", {}, services);
    assert.deepEqual(await handleExecutionGateway(deps, current, "renew", {}, services), { renewed: true });
    const rolledBackName = `${tableName}-rollback`;
    const dataCall = { name: "create_table", toolCallId: "atomic-data-1", input: { name: rolledBackName } };
    await assert.rejects(handleExecutionGateway(deps, current, "tool", dataCall, { ...services, executeTool: async input => {
      await executeProductTool(scope, input);throw new Error("Fixture receipt failure");
    } }), /Fixture receipt failure/);
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, rolledBackName)))).length, 0, "receipt failure rolls back the business write");
    await handleExecutionGateway(deps, current, "tool", dataCall, services);
    assert.equal((await db.select().from(tables).where(and(eq(tables.organizationId, org), eq(tables.name, rolledBackName)))).length, 1);
    await handleExecutionGateway(deps, current, "release", {}, services);
    const newerLease = await claimRuntimeLease(deps, authority.thread.id, actor);
    await assert.rejects(handleExecutionGateway(deps, current, "renew", {}, services), error => error instanceof ServiceError && error.status === 409, "a released capability cannot renew across a newer thread fence");
    await releaseRuntimeLease(deps, newerLease);
    const cancelled = await createAccepted("Cancel before the first model call");
    await requestRunCancellation(deps, cancelled.thread.id, cancelled.run.id, actor);
    await runChild(await launch(cancelled.reference.executionId));
    assert.equal(requests.length, 3);
    assert.equal((await loadNativeExecution(deps, cancelled.reference.executionId)).run.status, "cancelled");
    const stoppedOutput = await readNativeExecutionOutput(deps, { executionId: cancelled.reference.executionId, actor, limit: 500 });
    assert(stoppedOutput.terminal);assert(!JSON.stringify(stoppedOutput.events).includes("系统提示"));
    assert.equal((await db.select().from(agentRuns).where(eq(agentRuns.threadId, first.thread.id))).length, 1);
    assert.equal((await db.select().from(agentExecutions).where(eq(agentExecutions.runId, first.run.id))).length, 2);
    const departed = await createAccepted("Revoked membership cannot use the gateway");
    const revoked = await launch(departed.reference.executionId);
    await handleExecutionGateway(deps, revoked, "bootstrap", {}, services);
    await db.delete(member).where(eq(member.id, owner));
    await assert.rejects(handleExecutionGateway(deps, revoked, "tool", { name: "create_table", toolCallId: "revoked", input: { name: "Forbidden" } }, services), error => error instanceof ServiceError && error.status === 404);
  } finally {
    provider.closeAllConnections();gateway.closeAllConnections();
    await Promise.all([new Promise<void>(done => provider.close(() => done())), new Promise<void>(done => gateway.close(() => done()))]);
    await db.delete(organization).where(eq(organization.id, org));
    for (const id of [owner, agentUser]) await db.delete(user).where(eq(user.id, id));
    await resource.close();
  }
});
