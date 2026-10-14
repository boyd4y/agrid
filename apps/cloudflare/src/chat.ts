import { z } from "zod";
import type { UIMessage } from "ai";
import type { NativeQuestionResultRequest, AskUserQuestionsInput, AskUserQuestionsOutput } from "@tabdo/shared";
import { resolveActor } from "@tabdo/backend/auth/actor";
import { resolveChatAgentConfiguration } from "@tabdo/backend/agent/admission";
import { requireThread } from "@tabdo/backend/chat/store";
import { claimRuntimeLease,prepareRuntimeRecord,releaseRuntimeLease,type RuntimeRecord } from "@tabdo/backend/agent/runtime-store";
import { beginNativeRun } from "@tabdo/backend/agent/runs";
import { acceptNativeExecution,type NativeExecutionReference } from "@tabdo/backend/agent/executions";
import { resumeQuestionRun,type PendingQuestionCall } from "@tabdo/backend/agent/questions";
import { ServiceError } from "@tabdo/backend/errors";
import type { AcquireProductScope,ProductScope } from "./product-scope.js";
import { resolveProductContext,type ResolvedAgentConfiguration,type ResolvedChatContext } from "./agent-preparation.js";
import { readGatewayJson } from "./gateway.js";

export type QuestionPair = Readonly<{ input: unknown; output: unknown }>;
export type ValidatedQuestionPair = Readonly<{ input: AskUserQuestionsInput; output: AskUserQuestionsOutput }>;
export type ProductChatOptions<Env> = Readonly<{
  acquire: AcquireProductScope<Env>;
  prepare(env: Env,scope: ProductScope,input: { configuration: ResolvedAgentConfiguration; context: ResolvedChatContext }): Promise<void>;
  dispatch(env: Env,reference: NativeExecutionReference): Promise<void>;
  subscribe(env: Env,request: Request,reference: NativeExecutionReference): Promise<Response>;
  validateQuestions?(env: Env,pairs: readonly QuestionPair[]): Promise<readonly ValidatedQuestionPair[]>;
  status?(env: Env): unknown;
}>;

const common = z.object({ id: z.uuid(),agentId: z.string().min(1),context: z.unknown() });
const submission = z.discriminatedUnion("intent",[
  common.extend({ intent: z.literal("message"),messages: z.array(z.object({ id: z.string().min(1).max(200),role: z.enum(["user","assistant"]),parts: z.array(z.object({ type: z.string() }).passthrough()).max(500) }).passthrough()).min(1) }),
  common.extend({ intent: z.literal("tool-result"),assistantMessageId: z.string().min(1),toolResults: z.array(z.object({ toolCallId: z.string().min(1),output: z.unknown() })).min(1).max(50) }),
]);
const canonical = (value: unknown): string => JSON.stringify(value,(_key,item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item);
type PendingContinuation = { pendingToolResults: PendingQuestionCall[] };

function questionContinuation(record: RuntimeRecord): PendingContinuation | undefined {
  const value = record.resumeState?.continueFrom as Partial<PendingContinuation> | undefined;
  return Array.isArray(value?.pendingToolResults) && value.pendingToolResults.some(call => call.toolName === "askUserQuestions") ? value as PendingContinuation : undefined;
}

function userPrompt(parts: readonly unknown[]): string {
  const text = parts.map(part => {
    if (!part || typeof part !== "object" || !("type" in part) || part.type !== "text" || !("text" in part) || typeof part.text !== "string")
      throw new ServiceError(400,{ message: "当前 Harness 只支持文字消息内容，暂不支持图片或文件附件" });
    return part.text;
  }).join("\n\n");
  if (!text.trim()) throw new ServiceError(400,{ message: "请输入要执行的任务" });
  return text;
}

async function validatorsFor<Env>(options: ProductChatOptions<Env>,env: Env,record: RuntimeRecord,body: NativeQuestionResultRequest) {
  const continuation = questionContinuation(record);
  if (!continuation || body.assistantMessageId !== record.lastAssistantMessageId) throw new ServiceError(409,{ message: "此问题已不再等待回答，请刷新对话" });
  if (!options.validateQuestions) throw new ServiceError(503,{ message: "原生问题校验服务未配置" });
  const pairs = body.toolResults.map(result => {
    const pending = continuation.pendingToolResults.find(call => call.toolCallId === result.toolCallId && call.toolName === "askUserQuestions");
    if (!pending) throw new ServiceError(400,{ message: "此工具调用不在待回答问题中" });
    return { input: JSON.parse(pending.input) as unknown,output: result.output };
  });
  const validated = await options.validateQuestions(env,pairs);
  if (validated.length !== pairs.length) throw new ServiceError(503,{ message: "原生问题校验结果不完整" });
  // Results originate only from our trusted finite official-SDK validator RPC.
  // These callbacks cannot approve a client value that was not sent to that validator.
  return {
    getContinuation: questionContinuation,
    getPendingCalls: (value: PendingContinuation) => value.pendingToolResults,
    async validateInput(value: unknown) {
      const index = pairs.findIndex(pair => canonical(pair.input) === canonical(value));
      if (index < 0) throw new ServiceError(400,{ message: "提问格式无效" });
      return validated[index].input;
    },
    async validateOutput(value: unknown) {
      const index = pairs.findIndex(pair => canonical(pair.output) === canonical(value));
      if (index < 0) throw new ServiceError(400,{ message: "回答格式无效" });
      return validated[index].output;
    },
  };
}

/** Public AI UI transport. Persist acceptance before dispatch; disconnect never cancels accepted work. */
export function createProductChatHandlers<Env>(options: ProductChatOptions<Env>) {
  return {
    status(_request: Request,env: Env) { return Response.json(options.status?.(env) ?? { mode: "unconfigured",providers: [],harnesses: [] }); },
    async post(request: Request,env: Env,executionContext?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
      const scope = await options.acquire(env);
      try {
        const actor = await resolveActor(request,scope.identity);
        if (!actor?.organizationId) throw new ServiceError(401,{ message: "未授权" });
        const raw = z.record(z.string(),z.unknown()).parse(await readGatewayJson(request,4 * 1024 * 1024));
        const body = submission.parse({ intent: "message",...raw });
        const context = await resolveProductContext(scope,body.context,actor);
        const thread = await requireThread(scope.runtime,body.id,actor);
        if (thread.kind === "scheduled_task" && thread.scheduledTaskId !== context.context.scheduledTaskId) throw new ServiceError(409,{ message: "请在定时任务中打开此运行" });
        if (thread.status !== "regular") throw new ServiceError(409,{ message: "对话状态无效，请刷新后重试" });
        if (thread.custom.resourceKey !== context.resourceKey) throw new ServiceError(409,{ message: "对话与当前页面资源不一致，请新建对话" });
        const configuration = await resolveChatAgentConfiguration(scope.runtime,{ actor,agentId: body.agentId,context });
        const { profile,harness,mode } = configuration;
        if (typeof thread.custom.agentId === "string" && ![profile.memberId,profile.userId].includes(thread.custom.agentId)) throw new ServiceError(409,{ message: "此对话需要使用原智能体继续，请新建对话选择其他智能体" });
        const messages = (body.intent === "message" ? body.messages : []) as UIMessage[];
        const lastUser = [...messages].reverse().find(message => message.role === "user");
        if (body.intent === "message" && !lastUser) throw new ServiceError(400,{ message: "缺少用户消息" });
        const prompt = lastUser ? userPrompt(lastUser.parts) : "";
        await options.prepare(env,scope,{ configuration,context });
        request.signal.throwIfAborted();
        const lease = await claimRuntimeLease(scope.runtime,body.id,actor);
        let reference: NativeExecutionReference;
        try {
          const record = await prepareRuntimeRecord(scope.runtime,lease,actor,{ profileId: profile.id,harness,mode });
          request.signal.throwIfAborted();
          if (questionContinuation(record) && body.intent === "message") throw new ServiceError(409,{ message: "智能体正在等待问题回答，请在问题卡片中选择或填写答案" });
          let resumed: Awaited<ReturnType<typeof resumeQuestionRun>> | undefined;
          if (body.intent === "tool-result") {
            // The backend consumes raw answers only through the official validation callbacks.
            const questionRequest = body as NativeQuestionResultRequest;
            const validators = await validatorsFor(options,env,record,questionRequest);
            request.signal.throwIfAborted();
            resumed = await resumeQuestionRun({ ...scope.runtime,...validators },lease,actor,record,questionRequest);
          }
          const { id: messageId,...content } = lastUser ?? { id: "",role: "user",parts: [] };
          const run = resumed?.run ?? await beginNativeRun(scope.runtime,lease,actor,record,{ id: messageId,parentId: null,format: "ai-sdk/v6",content },profile.memberId);
          reference = await acceptNativeExecution(scope.runtime,{ actor,lease,run,context: context.context,prompt,toolResultContinuations: resumed?.toolResultContinuations });
        } finally { await releaseRuntimeLease(scope.runtime,lease); }
        // Queue publication / Container spawn acknowledge bounded acceptance only.
        // A failed wakeup never rolls back or resubmits the already accepted input.
        const wake = options.dispatch(env,reference).catch(() => console.warn("agent.dispatch.pending"));
        // Return the durable SSE subscription while finite container startup runs.
        // Only process-spawn acknowledgement is held here, never the agent turn.
        if (executionContext) executionContext.waitUntil(wake);
        else await wake;
        return await options.subscribe(env,request,reference);
      } finally { await scope.close(); }
    },
  };
}
