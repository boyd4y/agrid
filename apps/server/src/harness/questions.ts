import { HARNESS_V1_BUILTIN_TOOLS } from "@ai-sdk/harness";
import type { HarnessAgentContinueTurnState } from "@ai-sdk/harness/agent";
import type { AskUserQuestionsInput, AskUserQuestionsOutput, NativeQuestionResultRequest } from "@tabdo/shared";
import { asSchema, type ToolResultPart, type UIMessage } from "ai";
import * as service from "../business/agent/questions.js";
import { ServiceError } from "../business/errors.js";
import type { Actor } from "../auth/actor.js";
import type { RuntimeLease, RuntimeRecord } from "./store.js";
import type { AgentRun } from "./runs.js";
import { businessCall, runtimeDependencies } from "../services/dependencies.js";

export const QUESTION_NOT_INVOKED = service.QUESTION_NOT_INVOKED;

/** The official SDK owns its opaque continuation and schema definitions. */
export function questionContinuation(record: RuntimeRecord): HarnessAgentContinueTurnState | undefined {
  const continuation = record.resumeState?.continueFrom as HarnessAgentContinueTurnState | undefined;
  return continuation?.pendingToolResults?.some(pending => pending.toolName === "askUserQuestions") ? continuation : undefined;
}
async function validateSchema<T>(schema: Parameters<typeof asSchema<T>>[0], value: unknown): Promise<T> {
  const validation = await asSchema(schema).validate?.(value);
  if (!validation?.success) throw new ServiceError(400, { message: "提问或回答格式无效" });
  return validation.value;
}
const validators: service.QuestionSchemaValidators = {
  validateInput: value => validateSchema<AskUserQuestionsInput>(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.inputSchema, value),
  validateOutput: value => validateSchema<AskUserQuestionsOutput>(HARNESS_V1_BUILTIN_TOOLS.askUserQuestions.outputSchema!, value),
};

export async function validateQuestionAnswer(input: AskUserQuestionsInput, output: unknown) {
  return businessCall(() => service.validateQuestionAnswer(validators, input, output));
}

export async function resumeQuestionRun(lease: RuntimeLease, actor: Actor, record: RuntimeRecord, request: NativeQuestionResultRequest): Promise<{ run: AgentRun; continuation: HarnessAgentContinueTurnState; toolResultContinuations: ToolResultPart[]; messages: UIMessage[] }> {
  return businessCall(() => service.resumeQuestionRun({ ...runtimeDependencies(), ...validators,
    getContinuation: questionContinuation,
    getPendingCalls: continuation => continuation.pendingToolResults ?? [],
  }, lease, actor, record, request));
}
