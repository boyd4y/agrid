import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import type { HarnessAgentContinueTurnState } from "@ai-sdk/harness/agent";
import type { AskUserQuestionsInput, AskUserQuestionsOutput, NativeQuestionResultRequest } from "@tabdo/shared";
import { asSchema, type ToolResultPart, type UIMessage } from "ai";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Actor } from "../auth/actor.js";
import { saveMessageInTransaction } from "../chat/store.js";
import { agentRuns, chatMessages } from "../db/schema.js";
import { withRuntimeLease, type RuntimeLease, type RuntimeRecord } from "./store.js";
import type { AgentRun } from "./runs.js";

export function questionContinuation(record: RuntimeRecord): HarnessAgentContinueTurnState | undefined {
  const continuation = record.resumeState?.continueFrom as HarnessAgentContinueTurnState | undefined;
  return continuation?.pendingToolResults?.some((pending) => pending.toolName === "askUserQuestions") ? continuation : undefined;
}

async function validateSchema<T>(schema: Parameters<typeof asSchema<T>>[0], value: unknown): Promise<T> {
  const validation = await asSchema(schema).validate?.(value);
  if (!validation?.success) throw new HTTPException(400, { message: "提问或回答格式无效" });
  return validation.value;
}

export async function validateQuestionAnswer(input: AskUserQuestionsInput, output: unknown): Promise<AskUserQuestionsOutput> {
  const answer = await validateSchema<AskUserQuestionsOutput>(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.outputSchema!, output);
  if (!("answers" in answer)) return answer;
  if (answer.action === "partially-answered" && !input.allowPartialAnswers) throw new HTTPException(400, { message: "此问题需要完整回答" });
  const questions = new Map(input.questions.map((question) => [question.id, question]));
  for (const [id, selection] of Object.entries(answer.answers)) {
    const question = questions.get(id);
    if (!question) throw new HTTPException(400, { message: "回答引用了未知问题" });
    const allowed = new Set(question.options?.map((option) => option.id));
    if (selection.optionIds.some((option) => !allowed.has(option)) || new Set(selection.optionIds).size !== selection.optionIds.length)
      throw new HTTPException(400, { message: "回答引用了无效选项" });
    if (!question.allowMultiple && selection.optionIds.length > 1) throw new HTTPException(400, { message: "此问题只允许选择一个选项" });
    if (selection.freeform && question.allowFreeForm === false) throw new HTTPException(400, { message: "此问题不接受自由文本" });
    if (!selection.optionIds.length && !selection.freeform?.trim()) throw new HTTPException(400, { message: "请提供问题的回答" });
  }
  if (answer.action === "answered" && input.questions.some((question) => !answer.answers[question.id]))
    throw new HTTPException(400, { message: "请回答全部问题" });
  return answer;
}

/** Bind answers to the stored SDK continuation, never to client-created calls. */
export async function resumeQuestionRun(lease: RuntimeLease, actor: Actor, record: RuntimeRecord, request: NativeQuestionResultRequest): Promise<{ run: AgentRun; continuation: HarnessAgentContinueTurnState; toolResultContinuations: ToolResultPart[]; messages: UIMessage[] }> {
  const continuation = questionContinuation(record);
  if (!continuation || request.assistantMessageId !== record.lastAssistantMessageId)
    throw new HTTPException(409, { message: "此问题已不再等待回答，请刷新对话" });
  const pending = new Map(continuation.pendingToolResults!.map((call) => [call.toolCallId, call]));
  const seen = new Set<string>();
  const results: ToolResultPart[] = [];
  for (const submission of request.toolResults) {
    const call = pending.get(submission.toolCallId);
    if (!call || call.toolName !== "askUserQuestions" || seen.has(submission.toolCallId))
      throw new HTTPException(400, { message: "此工具调用不在待回答问题中" });
    seen.add(call.toolCallId);
    const input = await validateSchema<AskUserQuestionsInput>(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.inputSchema, JSON.parse(call.input));
    const output = await validateQuestionAnswer(input, submission.output);
    results.push({ type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "json", value: output }, ...(call.providerOptions ? { providerOptions: call.providerOptions } : {}) });
  }
  if (!results.length) throw new HTTPException(400, { message: "缺少问题回答" });
  return withRuntimeLease(lease, async (tx) => {
    const [run] = await tx.select().from(agentRuns).where(and(eq(agentRuns.threadId, lease.threadId), eq(agentRuns.runtimeSessionId, record.id), eq(agentRuns.assistantMessageId, request.assistantMessageId)));
    if (!run || run.userMessageId !== record.lastUserMessageId)
      throw new HTTPException(409, { message: "此问题已不再等待回答，请刷新对话" });
    const [stored] = await tx.select().from(chatMessages).where(and(eq(chatMessages.threadId, lease.threadId), eq(chatMessages.messageId, request.assistantMessageId)));
    if (!stored || !stored.serverFinal || stored.content.role !== "assistant") throw new HTTPException(409, { message: "提问消息未完整保存，请刷新对话" });
    if (!Array.isArray(stored.content.parts)) throw new HTTPException(409, { message: "提问消息未完整保存，请刷新对话" });
    const parts = stored.content.parts as UIMessage["parts"];
    if (results.some((result) => parts.filter((part) => "toolCallId" in part && part.toolCallId === result.toolCallId && (part.type === "tool-askUserQuestions" || part.type === "dynamic-tool" && part.toolName === "askUserQuestions")).length !== 1))
      throw new HTTPException(409, { message: "提问消息与原生工具调用不一致，请刷新对话" });
    const content = { ...stored.content, parts: parts.map((part) => {
      const tool = part as { toolCallId?: string };
      const result = results.find((result) => result.toolCallId === tool.toolCallId);
      return result ? { ...part, state: "output-available", output: (result.output as { type: "json"; value: unknown }).value } : part;
    }) };
    await saveMessageInTransaction(tx, lease.threadId, actor, { id: stored.messageId, parentId: stored.parentId, format: stored.format, content }, true);
    const [activeRun] = await tx.update(agentRuns).set({ status: "running", fence: lease.fence, endedAt: null, error: null, cancelRequestedAt: null }).where(eq(agentRuns.id, run.id)).returning();
    return { run: activeRun, continuation, toolResultContinuations: results, messages: [{ id: stored.messageId, ...content } as UIMessage] };
  });
}
