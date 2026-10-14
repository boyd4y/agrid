import { HTTPException } from "hono/http-exception";
import { chatRequestLimits } from "./limits.js";

const tooLarge = () => new HTTPException(413, { message: "对话请求过大，请减少消息或附件内容" });

/** Bound actual bytes even when Content-Length is absent or understated. */
export async function readChatRequestBody(request: Request): Promise<unknown> {
  const { maxRequestBodyBytes } = chatRequestLimits();
  if (Number(request.headers.get("content-length")) > maxRequestBodyBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new HTTPException(400, { message: "缺少请求内容" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBodyBytes) { await reader.cancel().catch(() => {});throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw new HTTPException(400, { message: "请求 JSON 无效" }); }
}

export function validateChatMessageBudget(messages: { role: string; parts: unknown[] }[]) {
  const limits = chatRequestLimits();
  if (messages.length > limits.maxMessagesPerRequest || Buffer.byteLength(JSON.stringify(messages)) > limits.maxMessagePartBytes) throw tooLarge();
  for (const message of messages) {
    let textBytes = 0;
    for (const part of message.parts) {
      if (Buffer.byteLength(JSON.stringify(part)) > limits.maxMessagePartBytes) throw tooLarge();
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") textBytes += Buffer.byteLength(text);
    }
    if (textBytes > limits.maxPromptBytes) throw tooLarge();
  }
}

export function validateChatPromptBudget(prompt: string) {
  if (Buffer.byteLength(prompt) > chatRequestLimits().maxPromptBytes) throw tooLarge();
}
