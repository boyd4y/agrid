import type { AskUserQuestionsInput, AskUserQuestionsOutput, NativeQuestionResultRequest } from "@tabdo/shared";
import type { ToolResultPart, UIMessage } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { ServiceError } from "../errors.js";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Actor } from "../auth/actor.js";
import { saveMessageInTransaction } from "../chat/store.js";
import { agentExecutions, agentRuns, chatMessages, member } from "../db/schema.js";
import { withRuntimeLease, type RuntimeLease, type RuntimeRecord } from "./runtime-store.js";
import type { AgentRun } from "./runs.js";
import { QUESTION_NOT_INVOKED } from "./checkpoints.js";
export { QUESTION_NOT_INVOKED } from "./checkpoints.js";

/** Official schema validation is injected by the Harness assembly, never reimplemented here. */
export type QuestionSchemaValidators = Readonly<{
  validateInput(value: unknown): Promise<AskUserQuestionsInput>;
  validateOutput(value: unknown): Promise<AskUserQuestionsOutput>;
}>;
export type PendingQuestionCall = Readonly<{
  toolCallId: string;
  toolName: string;
  input: string;
  providerOptions?: ToolResultPart["providerOptions"];
}>;
export type QuestionDependencies<Continuation> = RuntimeDependencies & QuestionSchemaValidators & Readonly<{
  getContinuation(record: RuntimeRecord): Continuation | undefined;
  getPendingCalls(continuation: Continuation): readonly PendingQuestionCall[];
}>;

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function retryProofMatches(metadata: unknown, run: AgentRun, results: ToolResultPart[]): boolean {
  if (!metadata || typeof metadata !== "object" || !("nativeQuestionInvocation" in metadata)) return false;
  const proof = metadata.nativeQuestionInvocation;
  return Boolean(proof && typeof proof === "object" && "proof" in proof && proof.proof === QUESTION_NOT_INVOKED
    && "runId" in proof && proof.runId === run.id && "fence" in proof && proof.fence === run.fence
    && "toolCallIds" in proof && Array.isArray(proof.toolCallIds)
    && canonical(proof.toolCallIds) === canonical(results.map(result => result.toolCallId).sort()));
}

export async function validateQuestionAnswer(deps: QuestionSchemaValidators, input: AskUserQuestionsInput, output: unknown): Promise<AskUserQuestionsOutput> {
  const answer = await deps.validateOutput(output);
  if (!("answers" in answer)) return answer;
  if (answer.action === "partially-answered" && !input.allowPartialAnswers) throw new ServiceError(400, { message: "此问题需要完整回答" });
  const questions = new Map(input.questions.map((question) => [question.id, question]));
  for (const [id, selection] of Object.entries(answer.answers)) {
    const question = questions.get(id);
    if (!question) throw new ServiceError(400, { message: "回答引用了未知问题" });
    const allowed = new Set(question.options?.map((option) => option.id));
    if (selection.optionIds.some((option) => !allowed.has(option)) || new Set(selection.optionIds).size !== selection.optionIds.length)
      throw new ServiceError(400, { message: "回答引用了无效选项" });
    if (!question.allowMultiple && selection.optionIds.length > 1) throw new ServiceError(400, { message: "此问题只允许选择一个选项" });
    if (selection.freeform && question.allowFreeForm === false) throw new ServiceError(400, { message: "此问题不接受自由文本" });
    if (!selection.optionIds.length && !selection.freeform?.trim()) throw new ServiceError(400, { message: "请提供问题的回答" });
  }
  if (answer.action === "answered" && input.questions.some((question) => !answer.answers[question.id]))
    throw new ServiceError(400, { message: "请回答全部问题" });
  return answer;
}

/** Bind answers to the stored SDK continuation, never to client-created calls. */
export async function resumeQuestionRun<Continuation>(deps: QuestionDependencies<Continuation>, lease: RuntimeLease, actor: Actor, record: RuntimeRecord, request: NativeQuestionResultRequest): Promise<{ run: AgentRun; continuation: Continuation; toolResultContinuations: ToolResultPart[]; messages: UIMessage[] }> {
  const continuation = deps.getContinuation(record);
  if (!continuation || request.assistantMessageId !== record.lastAssistantMessageId)
    throw new ServiceError(409, { message: "此问题已不再等待回答，请刷新对话" });
  const pending = new Map(deps.getPendingCalls(continuation).map((call) => [call.toolCallId, call]));
  const seen = new Set<string>();
  const results: ToolResultPart[] = [];
  for (const submission of request.toolResults) {
    const call = pending.get(submission.toolCallId);
    if (!call || call.toolName !== "askUserQuestions" || seen.has(submission.toolCallId))
      throw new ServiceError(400, { message: "此工具调用不在待回答问题中" });
    seen.add(call.toolCallId);
    const input = await deps.validateInput(JSON.parse(call.input));
    const output = await validateQuestionAnswer(deps, input, submission.output);
    results.push({ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "json", value: output }, ...(call.providerOptions ? { providerOptions: call.providerOptions } : {}) });
  }
  if (!results.length) throw new ServiceError(400, { message: "缺少问题回答" });
  return withRuntimeLease(deps, lease, async (tx) => {
    // Canonical answer acceptance and membership revocation serialize together.
    const [membership] = await tx.select({ id: member.id }).from(member)
      .where(and(eq(member.userId, actor.userId), eq(member.organizationId, actor.organizationId))).for("share");
    if (!membership) throw new ServiceError(404, { message: "对话不存在" });
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.threadId, lease.threadId), eq(agentRuns.runtimeSessionId, record.id), eq(agentRuns.assistantMessageId, request.assistantMessageId))).for("update");
    if (!run || run.userMessageId !== record.lastUserMessageId)
      throw new ServiceError(409, { message: "此问题已不再等待回答，请刷新对话" });
    // Both receipt acceptance and recovery hold this same Run row lock. A new
    // answer must never bypass a durable accepted or uncertain SDK invocation.
    const [execution] = await tx.select({ id: agentExecutions.id }).from(agentExecutions)
      .where(and(eq(agentExecutions.runId, run.id), inArray(agentExecutions.status, ["accepted", "invoking"])));
    if (execution) throw new ServiceError(409, { message: "此回答已有执行，请等待运行完成" });
    const [stored] = await tx.select().from(chatMessages).where(and(eq(chatMessages.threadId, lease.threadId), eq(chatMessages.messageId, request.assistantMessageId)));
    if (!stored || !stored.serverFinal || stored.content.role !== "assistant") throw new ServiceError(409, { message: "提问消息未完整保存，请刷新对话" });
    if (!Array.isArray(stored.content.parts)) throw new ServiceError(409, { message: "提问消息未完整保存，请刷新对话" });
    const parts = stored.content.parts as UIMessage["parts"];
    if (results.some((result) => parts.filter((part) => "toolCallId" in part && part.toolCallId === result.toolCallId && (part.type === "tool-askUserQuestions" || part.type === "dynamic-tool" && part.toolName === "askUserQuestions")).length !== 1))
      throw new ServiceError(409, { message: "提问消息与原生工具调用不一致，请刷新对话" });
    const calls = results.map(result => parts.find(part => "toolCallId" in part && part.toolCallId === result.toolCallId)!);
    const answered = calls.filter(part => "state" in part && part.state === "output-available");
    if (answered.length) {
      if (answered.length !== results.length || results.some((result, index) => !('output' in calls[index]) || canonical(calls[index].output) !== canonical((result.output as { type: "json"; value: unknown }).value)))
        throw new ServiceError(409, { message: "已接受的回答不能更换" });
      if (!["failed", "cancelled"].includes(run.status) || !retryProofMatches(stored.content.metadata, run, results))
        throw new ServiceError(409, { message: "此回答无法安全重试，请刷新对话" });
    } else if (run.status !== "suspended" || calls.some(part => !("state" in part) || part.state !== "input-available")) {
      throw new ServiceError(409, { message: "此问题已不再等待回答，请刷新对话" });
    }
    // Consume the proof in the same transaction. A later unknown start cannot
    // inherit a previous attempt's certificate and replay tools.
    const metadata = stored.content.metadata;
    const cleanMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "nativeQuestionInvocation")) : metadata;
    const content = { ...stored.content, ...(metadata !== undefined ? { metadata: cleanMetadata } : {}), parts: parts.map((part) => {
      const tool = part as { toolCallId?: string };
      const result = results.find((result) => result.toolCallId === tool.toolCallId);
      return result ? { ...part, state: "output-available", output: (result.output as { type: "json"; value: unknown }).value } : part;
    }) };
    await saveMessageInTransaction(deps, tx, lease.threadId, actor, { id: stored.messageId, parentId: stored.parentId, format: stored.format, content }, true);
    const [activeRun] = await tx.update(agentRuns).set({ status: "running", fence: lease.fence, endedAt: null, error: null, cancelRequestedAt: null }).where(eq(agentRuns.id, run.id)).returning();
    return { run: activeRun, continuation, toolResultContinuations: results, messages: [{ id: stored.messageId, ...content } as UIMessage] };
  });
}
