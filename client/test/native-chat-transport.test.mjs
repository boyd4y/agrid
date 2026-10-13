import assert from "node:assert/strict";
import test from "node:test";
import { AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { prepareNativeChatRequest } from "../src/lib/chat-persistence.ts";

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
