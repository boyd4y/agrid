import { lastAssistantMessageIsCompleteWithToolCalls, type HttpChatTransportInitOptions, type UIMessage } from "ai";
import type { AskUserQuestionsOutput, NativeQuestionResultRequest } from "@tabdo/shared";

/** Only results in the latest SDK step can continue a pending native turn. */
function questionResults(messages: UIMessage[]): NativeQuestionResultRequest | undefined {
  const assistant = messages.at(-1);
  if (assistant?.role !== "assistant") return;
  let stepStart = -1;
  assistant.parts.forEach((part, index) => { if (part.type === "step-start") stepStart = index; });
  const parts = assistant.parts.slice(stepStart + 1);
  const questions = parts.filter(part => part.type === "tool-askUserQuestions" || (part.type === "dynamic-tool" && part.toolName === "askUserQuestions"));
  if (!questions.length || questions.some(part => !("state" in part) || part.state !== "output-available")) return;
  return {
    intent: "tool-result",
    assistantMessageId: assistant.id,
    toolResults: questions.map(part => ({ toolCallId: (part as { toolCallId: string }).toolCallId, output: (part as { output: AskUserQuestionsOutput }).output })),
  };
}

export function shouldContinueNativeQuestions({ messages }: { messages: UIMessage[] }): boolean {
  return Boolean(questionResults(messages)) && lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

/** Native history stays server-owned. Tool answers resume the same turn, without replaying prompts. */
export const prepareNativeChatRequest: NonNullable<HttpChatTransportInitOptions<UIMessage>["prepareSendMessagesRequest"]> = ({ id, messages, body, trigger, messageId, requestMetadata }) => {
  const result = questionResults(messages);
  if (result) return { body: { ...body, id, ...result } };
  const latestUser = [...messages].reverse().find(message => message.role === "user");
  return { body: { ...body, id, messages: latestUser ? [latestUser] : [], trigger, messageId, metadata: requestMetadata } };
};
