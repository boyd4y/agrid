import assert from "node:assert/strict";
import test from "node:test";
import { AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { prepareNativeChatRequest } from "../src/lib/native-chat-transport.ts";

test("official native transport submits one fresh user from a long UI history without changing displayed history", async () => {
  const history = Array.from({ length: 250 }, (_, index) => ({
    id: `old-${index}`,
    role: index % 2 ? "assistant" : "user",
    parts: [{ type: "text", text: "old UI history must not be replayed" }],
  }));
  const freshUser = { id: "fresh-input", role: "user", parts: [{ type: "text", text: "接着整理下一步" }] };
  // A local HTTP-error assistant can trail the current user without becoming input.
  const localError = { id: "local-error", role: "assistant", parts: [{ type: "text", text: "HTTP request failed" }] };
  history.push(freshUser, localError);
  const original = structuredClone(history);
  let received;
  const transport = new AssistantChatTransport({
    api: "http://native-chat.test/api/chat",
    body: { agentId: "agent-1", context: { page: "ai", tableId: null } },
    prepareSendMessagesRequest: prepareNativeChatRequest,
    fetch: async (url, init) => {
      assert.equal(url, "http://native-chat.test/api/chat");
      received = JSON.parse(init.body);
      return new Response('data: {"type":"finish"}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "thread-1", messageId: freshUser.id, messages: history, abortSignal: undefined });
  for await (const _part of stream) { /* Consume the actual official transport. */ }
  assert.deepEqual(received.messages, [freshUser]);
  assert.equal(received.id, "thread-1");
  assert.equal(received.agentId, "agent-1");
  assert.deepEqual(received.context, { page: "ai", tableId: null });
  assert(!JSON.stringify(received).includes("old UI history must not be replayed"));
  assert.deepEqual(history, original);
});

test("native questions submit tool outputs in the same assistant turn without replaying user history", async () => {
  const { shouldContinueNativeQuestions } = await import("../src/lib/native-chat-transport.ts");
  const answer = { action: "answered", answers: { target: { optionIds: ["b"], freeform: "选择现有表" } } };
  const question = { type: "tool-askUserQuestions", toolCallId: "question-1", state: "input-available", input: { allowPartialAnswers: false, questions: [{ id: "target", question: "选择来源", options: [{ id: "b", label: "表格" }] }] } };
  const history = [{ id: "u1", role: "user", parts: [{ type: "text", text: "generate records" }] }, { id: "a1", role: "assistant", parts: [{ type: "step-start" }, question] }];
  assert.equal(shouldContinueNativeQuestions({ messages: history }), false);
  history[1].parts[1] = { ...question, state: "output-available", output: answer };
  assert.equal(shouldContinueNativeQuestions({ messages: history }), true);
  const request = await prepareNativeChatRequest({ id: "thread-1", messages: history, body: { agentId: "agent-1" }, trigger: "submit-message" });
  assert.deepEqual(request.body, { id: "thread-1", agentId: "agent-1", intent: "tool-result", assistantMessageId: "a1", toolResults: [{ toolCallId: "question-1", output: answer }] });
  assert(!("messages" in request.body));
  // A resumed model step must never resubmit an earlier answered question.
  history[1].parts.push({ type: "step-start" }, { type: "text", text: "已完成" });
  assert.equal(shouldContinueNativeQuestions({ messages: history }), false);
  history.push({ id: "u2", role: "user", parts: [{ type: "text", text: "下一步" }] });
  const fresh = await prepareNativeChatRequest({ id: "thread-1", messages: history, body: {}, trigger: "submit-message" });
  assert.deepEqual(fresh.body.messages, [history[2]]);
});
