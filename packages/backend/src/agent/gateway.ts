import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { ToolResultPart, UIMessage } from "ai";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { ServiceError } from "../errors.js";
import { sha256 } from "../auth/hash.js";
import { agentExecutionGateways, agentExecutionToolCalls } from "../db/gateway-schema.js";
import { agentExecutions, agentRuns, chatMessages, member } from "../db/schema.js";
import { saveMessageInTransaction } from "../chat/store.js";
import { loadNativeExecution, recoverAcceptedNativeExecution, claimNativeExecution, appendNativeExecutionChunk, appendNativeExecutionChunks, settleNativeExecution, type LoadedNativeExecution } from "./executions.js";
import { releaseRuntimeLease, withRuntimeLease, completeRuntimeTurn, completeUninvokedPiRun } from "./runtime-store.js";
import { recordRunActivity, runCancellationRequested, failNativeRun } from "./runs.js";
import type { GatewayAction, GatewayActions, GatewayCredentials, GatewayPreparedAgent } from "./gateway-contracts.js";

export type GatewayServices = {
  prepare(loaded: LoadedNativeExecution): Promise<GatewayPreparedAgent>;
  /** Must use this transaction for all effects; external side effects are forbidden here. */
  executeTool(input: { loaded: LoadedNativeExecution; tx: Transaction; name: string; input: unknown; toolCallId: string }): Promise<unknown>;
};
const MAX_TTL_MS = 30 * 60_000;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export async function issueExecutionGateway(deps: RuntimeDependencies, executionId: string, options: { launchToken: string; ttlMs?: number }) {
  z.uuid().parse(options.launchToken);
  const loaded = await recoverAcceptedNativeExecution(deps, executionId);
  if (loaded.execution.status !== "accepted") throw new ServiceError(409, { message: "执行已启动，无法签发新的执行能力" });
  const token = `${deps.uuid()}.${deps.uuid()}.${deps.uuid()}`;
  const tokenHash = await sha256(token);
  const ttl = z.number().int().min(60_000).max(MAX_TTL_MS).parse(options.ttlMs ?? MAX_TTL_MS);
  const expiresAt = new Date(deps.now().getTime() + ttl);
  await withRuntimeLease(deps, loaded.lease, async tx => {
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, loaded.run.id)).for("update");
    const [execution] = await tx.select().from(agentExecutions).where(eq(agentExecutions.id, executionId)).for("update");
    const [membership] = await tx.select({ id: member.id }).from(member).where(and(eq(member.userId, loaded.actor.userId), eq(member.organizationId, loaded.actor.organizationId))).for("share");
    if (!membership || !run || run.fence !== loaded.lease.fence || execution?.status !== "accepted"
      || execution.fence !== loaded.lease.fence || execution.leaseToken !== loaded.lease.token) throw new ServiceError(409, { message: "执行已启动" });
    const grant = { executionId, launchToken: options.launchToken, tokenHash, runId: run.id, threadId: run.threadId,
      userId: loaded.actor.userId, fence: loaded.lease.fence, leaseToken: loaded.lease.token, expiresAt };
    await tx.insert(agentExecutionGateways).values(grant).onConflictDoUpdate({ target: agentExecutionGateways.executionId, set: grant });
  });
  return { executionId, launchToken: options.launchToken, token, expiresAt };
}

/** Re-resolve the owner from PostgreSQL; no principal, fence or Run id comes from the sandbox. */
export async function authorizeExecutionGateway(deps: RuntimeDependencies, credentials: GatewayCredentials): Promise<LoadedNativeExecution> {
  z.uuid().parse(credentials.executionId);z.uuid().parse(credentials.launchToken);
  if (typeof credentials.token !== "string" || credentials.token.length > 256 || credentials.token.length < 64)
    throw new ServiceError(401, { message: "执行能力无效" });
  const hash = await sha256(credentials.token);
  const [grant] = await deps.database.select().from(agentExecutionGateways).where(and(eq(agentExecutionGateways.executionId, credentials.executionId),
    eq(agentExecutionGateways.launchToken, credentials.launchToken), eq(agentExecutionGateways.tokenHash, hash), sql`${agentExecutionGateways.expiresAt}>clock_timestamp()`));
  if (!grant) throw new ServiceError(401, { message: "执行能力已失效" });
  const loaded = await loadNativeExecution(deps, credentials.executionId);
  if (loaded.run.id !== grant.runId || loaded.thread.id !== grant.threadId || loaded.actor.userId !== grant.userId
    || loaded.run.fence !== grant.fence || loaded.execution.fence !== grant.fence || loaded.execution.leaseToken !== grant.leaseToken)
    throw new ServiceError(409, { message: "执行能力已被新的运行接管" });
  return loaded;
}

/** Capability revocation, membership changes and each fenced effect serialize at commit. */
async function withGatewayAuthority<T>(deps: RuntimeDependencies, credentials: GatewayCredentials, loaded: LoadedNativeExecution, work: (tx: Transaction) => Promise<T>, expectedStatus: "accepted" | "invoking" = "invoking"): Promise<T> {
  const hash = await sha256(credentials.token);
  return withRuntimeLease(deps, loaded.lease, async tx => {
    const [membership] = await tx.select({ id: member.id }).from(member).where(and(eq(member.userId, loaded.actor.userId), eq(member.organizationId, loaded.actor.organizationId))).for("share");
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.id, loaded.run.id), eq(agentRuns.fence, loaded.lease.fence))).for("update");
    const [execution] = await tx.select().from(agentExecutions).where(and(eq(agentExecutions.id, loaded.execution.id), eq(agentExecutions.fence, loaded.lease.fence))).for("update");
    const [grant] = await tx.select().from(agentExecutionGateways).where(and(eq(agentExecutionGateways.executionId, loaded.execution.id),
      eq(agentExecutionGateways.tokenHash, hash), eq(agentExecutionGateways.launchToken, credentials.launchToken), sql`${agentExecutionGateways.expiresAt}>clock_timestamp()`)).for("share");
    if (!membership || !grant || !run || execution?.status !== expectedStatus || execution.leaseToken !== loaded.lease.token
      || grant.runId !== run.id || grant.threadId !== loaded.thread.id || grant.userId !== loaded.actor.userId || grant.fence !== loaded.lease.fence || grant.leaseToken !== loaded.lease.token)
      throw new ServiceError(409, { message: "执行能力已失效，无法提交运行结果" });
    return work(tx);
  });
}

async function executeGatewayTool(deps: RuntimeDependencies, credentials: GatewayCredentials, loaded: LoadedNativeExecution, payload: GatewayActions["tool"]["input"], services: GatewayServices) {
  z.string().min(1).max(200).parse(payload.toolCallId);z.string().min(1).max(200).parse(payload.name);
  return withGatewayAuthority(deps, credentials, loaded, async tx => {
    const [run] = await tx.select().from(agentRuns).where(eq(agentRuns.id, loaded.run.id));
    if (run.cancelRequestedAt || !["starting", "running"].includes(run.status)) throw new ServiceError(409, { message: "执行无法继续调用工具" });
    const [previous] = await tx.select().from(agentExecutionToolCalls).where(and(eq(agentExecutionToolCalls.executionId, loaded.execution.id), eq(agentExecutionToolCalls.toolCallId, payload.toolCallId))).for("update");
    if (previous) {
      if (previous.name !== payload.name || canonical(previous.input) !== canonical(payload.input)) throw new ServiceError(409, { message: "工具调用标识不能更换输入" });
      if (previous.status !== "completed") throw new ServiceError(409, { message: "工具调用结果不明确，不能重放" });
      return { result: previous.result };
    }
    const [receipt] = await tx.insert(agentExecutionToolCalls).values({ executionId: loaded.execution.id, toolCallId: payload.toolCallId, name: payload.name, input: payload.input }).returning();
    const result = await services.executeTool({ loaded, tx, ...payload });
    const normalized = result === undefined ? null : JSON.parse(JSON.stringify(result));
    await tx.update(agentExecutionToolCalls).set({ result: normalized, status: "completed", completedAt: deps.now() }).where(eq(agentExecutionToolCalls.id, receipt.id));
    return { result: normalized };
  });
}

/** Finite capability protocol. Payloads are data; there is no SQL, eval or arbitrary command endpoint. */
export async function handleExecutionGateway<Action extends GatewayAction>(deps: RuntimeDependencies, credentials: GatewayCredentials,
  action: Action, payload: GatewayActions[Action]["input"], services: GatewayServices): Promise<GatewayActions[Action]["output"]> {
  const loaded = await authorizeExecutionGateway(deps, credentials);
  const result = await (async (): Promise<unknown> => {
    if (action === "bootstrap") {
      if (loaded.execution.status !== "accepted" || !await withGatewayAuthority(deps, credentials, loaded, tx => claimNativeExecution(deps, loaded, tx), "accepted"))
        throw new ServiceError(409, { message: "执行已被领取，不能重复启动" });
      try {
        const prepared = await services.prepare(loaded);
        const continuing = loaded.execution.input.toolResultContinuations as ToolResultPart[] | undefined;
        const [stored] = await deps.database.select().from(chatMessages).where(and(eq(chatMessages.threadId, loaded.thread.id), eq(chatMessages.messageId, continuing ? loaded.run.assistantMessageId : loaded.run.userMessageId)));
        if (!stored || continuing && !stored.serverFinal) throw new ServiceError(409, { message: "已接受的输入不存在" });
        return { actor: loaded.actor, lease: loaded.lease, record: loaded.record, run: loaded.run, prepared,
          prompt: loaded.execution.input.prompt, messages: [{ id: stored.messageId, ...stored.content } as UIMessage], toolResultContinuations: continuing,
          metadata: { agentId: loaded.profile.memberId, harness: prepared.harness, modelId: prepared.modelId, runtime: loaded.record.mode } };
      } catch (error) {
        await failNativeRun(deps, loaded.lease, loaded.run.id, "执行准备失败");
        await settleNativeExecution(deps, loaded.execution.id, "执行准备失败");
        await releaseRuntimeLease(deps, loaded.lease);
        throw error;
      }
    }
    if (loaded.execution.status !== "invoking" && !["settle", "release", "cancelled"].includes(action)) throw new ServiceError(409, { message: "执行未启动或已关闭" });
    switch (action) {
      case "renew": {
        return withGatewayAuthority(deps, credentials, loaded, async tx => {
          await tx.update(agentExecutionGateways).set({ expiresAt: new Date(deps.now().getTime() + MAX_TTL_MS) }).where(eq(agentExecutionGateways.executionId, loaded.execution.id));
          return { renewed: true };
        });
      }
      case "cancelled": return { cancelled: await runCancellationRequested(deps, loaded.run.id) };
      case "activity": {
        const activity = (payload as GatewayActions["activity"]["input"]).activity;
        if (activity.threadId !== loaded.thread.id || activity.runId !== loaded.run.id) throw new ServiceError(409, { message: "运行活动范围不匹配" });
        return withGatewayAuthority(deps, credentials, loaded, async tx => ({ recorded: await recordRunActivity(deps, loaded.lease, loaded.run.id, activity, tx) }));
      }
      case "tool": return executeGatewayTool(deps, credentials, loaded, payload as GatewayActions["tool"]["input"], services);
      case "append": await withGatewayAuthority(deps, credentials, loaded, tx => appendNativeExecutionChunk(deps, loaded, (payload as GatewayActions["append"]["input"]).chunk, tx));break;
      case "appendBatch": await withGatewayAuthority(deps, credentials, loaded, tx => appendNativeExecutionChunks(deps, loaded, (payload as GatewayActions["appendBatch"]["input"]).chunks, tx));break;
      case "checkpoint": {
        const body = payload as GatewayActions["checkpoint"]["input"];
        if (body.message.id !== loaded.run.assistantMessageId || body.message.parentId !== loaded.run.userMessageId
          || body.checkpoint.userMessageId !== loaded.run.userMessageId || body.checkpoint.assistantMessageId !== loaded.run.assistantMessageId)
          throw new ServiceError(409, { message: "会话保存范围不匹配" });
        if (!["completed", "suspended", "failed", "cancelled"].includes(body.status)) throw new ServiceError(400, { message: "运行状态无效" });
        await withGatewayAuthority(deps, credentials, loaded, tx => completeRuntimeTurn(deps, loaded.lease, loaded.actor, loaded.record.id, body.checkpoint, body.message, { id: loaded.run.id, status: body.status, error: body.error }, tx));break;
      }
      case "uninvoked": {
        const body = payload as GatewayActions["uninvoked"]["input"];
        if (!["failed", "cancelled"].includes(body.status) || body.message.id !== loaded.run.assistantMessageId || body.message.parentId !== loaded.run.userMessageId || loaded.execution.input.toolResultContinuations)
          throw new ServiceError(409, { message: "无法证明首次执行尚未调用" });
        await withGatewayAuthority(deps, credentials, loaded, tx => completeUninvokedPiRun(deps, loaded.lease, loaded.actor, loaded.record.id, body.message, { id: loaded.run.id, status: body.status, error: body.error }, tx));break;
      }
      case "saveMessage": {
        const body = payload as GatewayActions["saveMessage"]["input"];
        if (body.message.id !== loaded.run.assistantMessageId || body.message.parentId !== loaded.run.userMessageId) throw new ServiceError(409, { message: "消息保存范围不匹配" });
        await withGatewayAuthority(deps, credentials, loaded, tx => saveMessageInTransaction(deps, tx, loaded.thread.id, loaded.actor, body.message, true));break;
      }
      case "fail": await withGatewayAuthority(deps, credentials, loaded, tx => failNativeRun(deps, loaded.lease, loaded.run.id, (payload as GatewayActions["fail"]["input"]).error, tx));break;
      case "release": await releaseRuntimeLease(deps, loaded.lease);break;
      case "settle": await settleNativeExecution(deps, loaded.execution.id, (payload as GatewayActions["settle"]["input"]).error);break;
      default: throw new ServiceError(400, { message: "未知执行动作" });
    }
    return { ok: true };
  })();
  return result as GatewayActions[Action]["output"];
}
