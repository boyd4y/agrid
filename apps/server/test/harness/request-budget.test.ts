import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { readChatRequestBody, validateChatMessageBudget, validateChatPromptBudget } from "../../src/harness/request-budget.js";

const oversized = (error: unknown) => error instanceof HTTPException && error.status === 413;
const message = (text = "hello") => ({ role: "user", parts: [{ type: "text", text }] });

test("message count, UTF-8 prompt and cumulative serialized parts budgets", () => {
  validateChatMessageBudget(Array.from({ length: 50 }, () => message()));
  assert.throws(() => validateChatMessageBudget(Array.from({ length: 51 }, () => message())), oversized);
  assert.throws(() => validateChatMessageBudget([message("中".repeat(22_000))]), oversized);
  assert.throws(() => validateChatMessageBudget(Array.from({ length: 5 }, () => message("a".repeat(60_000)))), oversized);
  assert.throws(() => validateChatPromptBudget("a".repeat(65_537)), oversized);
});

test("body reader enforces declared and streamed bytes including understated length", async () => {
  const app = new Hono();
  app.post("/", async c => c.json(await readChatRequestBody(c.req.raw) as object));
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "524289" }]) {
    const response = await app.request("/", { method: "POST", headers: new Headers(headers as Record<string, string>), body: JSON.stringify({ text: "a".repeat(524_288) }) });
    assert.equal(response.status, 413);
  }
  const chunks = new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < 9; i++) controller.enqueue(new Uint8Array(65_536));
    controller.close();
  } });
  await assert.rejects(() => readChatRequestBody(new Request("http://localhost/", { method: "POST", body: chunks, duplex: "half" } as RequestInit)), oversized);
  assert.deepEqual(await readChatRequestBody(new Request("http://localhost/", { method: "POST", body: '{"ok":true}' })), { ok: true });
  await assert.rejects(() => readChatRequestBody(new Request("http://localhost/", { method: "POST", body: "{" })), (error: unknown) => error instanceof HTTPException && error.status === 400);
});
