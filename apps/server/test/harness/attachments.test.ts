import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { HarnessCapabilityUnsupportedError } from "@ai-sdk/harness";
import type { UserModelMessage } from "ai";
import { HTTPException } from "hono/http-exception";
import { getHarnessAttachmentSupport, prepareHarnessUserPrompt } from "../../src/harness/attachments.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=";

test("attachment preflight reports installed adapter limits and never discards non-text user input", () => {
  for (const harness of ["pi", "codex", "claude"] as const) {
    const support = getHarnessAttachmentSupport(harness);
    assert.equal(support.supportsImages, false); assert.equal(support.supportsFiles, false);
    assert(support.adapterVersion.length > 0);
    assert.equal(prepareHarnessUserPrompt({ harness, parts: [{ type: "text", text: "Current user" }, { type: "text", text: "only" }] }), "Current user\n\nonly");
    for (const part of [
      { type: "file", mediaType: "image/png", url: png },
      { type: "image", image: png },
      { type: "file", mediaType: "application/pdf", url: "http://127.0.0.1/private.pdf" },
      { type: "file", mediaType: "text/plain", url: "file:///private/server-secret.txt" },
    ]) {
      assert.throws(() => prepareHarnessUserPrompt({ harness, parts: [{ type: "text", text: "Read attachment" }, part] }),
        (error: unknown) => error instanceof HTTPException && error.status === 400 && error.message === support.reason);
    }
  }
  for (const parts of [[], [{ type: "text", text: " " }], [{ type: "text", text: 42 }], [{ type: "tool-result" }], [null]]) {
    assert.throws(() => prepareHarnessUserPrompt({ harness: "pi", parts }), HTTPException);
  }
});

test("actual Pi rejects standard image/file prompts before provider calls, while fresh text still works", async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  let requests = 0;
  const provider = createServer(async (req, res) => {
    requests++;
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from(png.split(",")[1]!, "base64"));
      return;
    }
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write("data: " + JSON.stringify({ id: "attachment-fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
    send({ role: "assistant", content: "Fresh text received" }); send({}, "stop"); res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const env = { PI_API_KEY: "local-fixture", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const agent = createNativeAgent({ harness: "pi", mode: "local", env, modelId: "local-test", instructions: "Reply in text", tools: {}, skills: [] });
  const { sandbox } = await openNativeSandbox({ agent, mode: "local", sandboxId: "attachments-fixture", hasResumeState: false, env });
  const session = await agent.createSession({ sandboxSession: sandbox });
  try {
    for (const part of [
      { type: "image" as const, image: png },
      { type: "file" as const, data: new Uint8Array([65, 66]), mediaType: "text/plain" },
      { type: "image" as const, image: new URL(`http://127.0.0.1:${address.port}/private.png`) },
    ]) {
      const message: UserModelMessage = { role: "user", content: [{ type: "text", text: "Read this" }, part] };
      await assert.rejects(agent.generate({ session, messages: [message] }), (error: unknown) => HarnessCapabilityUnsupportedError.isInstance(error));
      assert.equal(requests, 0, "no image URL fetch or model call");
    }
    const prompt = prepareHarnessUserPrompt({ harness: "pi", parts: [{ type: "text", text: "Fresh user only" }] });
    assert.equal((await agent.generate({ session, prompt })).text, "Fresh text received");
    assert.equal(calls.length, 1); assert(JSON.stringify(calls[0].messages).includes("Fresh user only"));
    assert(!JSON.stringify(calls[0].messages).includes("Read this"), "rejected attachments never entered native history");
  } finally {
    await session.destroy(); await sandbox.destroy(); provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
