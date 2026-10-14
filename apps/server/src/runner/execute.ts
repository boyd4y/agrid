import type { ToolResultPart, UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDatabase } from "@tabdo/platform/resources";
import { chatMessages, member } from "../db/schema.js";
import { resolveChatContext } from "../chat/context.js";
import { chatErrorText } from "../ai/errors.js";
import { prepareNativeChatAgent } from "../harness/preparation.js";
import { executeNativeRun } from "../harness/execution.js";
import { failNativeRun } from "../harness/runs.js";
import { releaseRuntimeLease } from "../harness/store.js";
import { appendNativeExecutionChunk, claimNativeExecution, recoverAcceptedNativeExecution, settleNativeExecution } from "./repository.js";

/** Rebuild an accepted operation in a fresh process; only the persistent reference crosses transport. */
export async function executeAcceptedNativeRun(executionId: string, signal?: AbortSignal): Promise<{ claimed: boolean }> {
  const loaded = await recoverAcceptedNativeExecution(executionId);
  if (loaded.execution.status !== "accepted") return { claimed: false };
  if (!await claimNativeExecution(loaded)) return { claimed: false };
  let failure: string | undefined;
  try {
    const [agentMembership] = await getDatabase().select({ id: member.id }).from(member)
      .where(and(eq(member.userId, loaded.profile.userId), eq(member.organizationId, loaded.actor.organizationId)));
    if (!agentMembership) throw new HTTPException(403, { message: "智能体已离开工作区" });
    const context = await resolveChatContext(loaded.execution.input.context, loaded.actor);
    const prepared = await prepareNativeChatAgent({ actor: loaded.actor, agentId: loaded.profile.userId, context,
      boundTableId: loaded.execution.input.boundTableId });
    if (prepared.profile.id !== loaded.record.agentProfileId || prepared.harness !== loaded.record.harness || prepared.mode !== loaded.record.mode)
      throw new HTTPException(409, { message: "原生会话运行配置已变更" });
    const toolResultContinuations = loaded.execution.input.toolResultContinuations as ToolResultPart[] | undefined;
    const messageId = toolResultContinuations ? loaded.run.assistantMessageId : loaded.run.userMessageId;
    const [stored] = await getDatabase().select().from(chatMessages).where(and(eq(chatMessages.threadId, loaded.thread.id), eq(chatMessages.messageId, messageId)));
    if (!stored || (toolResultContinuations && !stored.serverFinal)) throw new HTTPException(409, { message: "已接受的原生输入不存在" });
    const messages = [{ id: stored.messageId, ...stored.content } as UIMessage];
    await executeNativeRun({ actor: loaded.actor, lease: loaded.lease, record: loaded.record, run: loaded.run,
      harness: prepared.harness, modelId: prepared.modelId, piModel: prepared.piModel, instructions: prepared.system,
      agentsDocument: prepared.agentsDocument, tools: prepared.tools, disabledTools: prepared.disabledTools, skills: prepared.skills,
      prompt: loaded.execution.input.prompt, messages, toolResultContinuations, signal,
      metadata: { agentId: prepared.profile.memberId, harness: prepared.harness, modelId: prepared.modelId, runtime: prepared.mode },
    }, undefined, { write: chunk => appendNativeExecutionChunk(loaded, chunk) });
    return { claimed: true };
  } catch (error) {
    failure = chatErrorText(error);
    // The invocation receipt is conservative even for preparation failure. Never
    // certify/replay an unknown turn merely because its resource exited early.
    await failNativeRun(loaded.lease, loaded.run.id, failure).catch(() => {});
    throw error;
  } finally {
    await settleNativeExecution(executionId, failure);
    await releaseRuntimeLease(loaded.lease);
  }
}
