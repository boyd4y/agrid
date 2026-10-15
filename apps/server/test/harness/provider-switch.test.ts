import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createDiskWorkspace } from "@tabdo/agent-runtime/sandbox/workspace";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { createHarnessAgent } from "@tabdo/agent-runtime/harness/agent";
import { createPiAdapter, type PiAdapterConfig } from "@tabdo/agent-runtime/harness/pi";
import { createLocalSandboxAdapter } from "@tabdo/agent-runtime/sandbox/local";
import { restoreWorkspace, snapshotWorkspace, type WorkspaceSnapshot } from "../../src/harness/workspace.js";
import { resolveNativeConfiguration } from "../../src/business/agent/runtime-configuration.js";

test("an actual Pi journal from a rejected router model resumes on the configured direct model", { timeout: 20000 }, async t => {
  const requests: { model: string; messages: { role: string; content: unknown }[] }[] = [];
  const server = createServer(async (request, response) => {
    let raw = "";for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);requests.push(body);
    if (body.model === "openrouter/free") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Use deepseek-flash instead of openrouter/free", type: "invalid_request_error" } }));return;
    }
    assert.equal(body.model, "deepseek-flash");
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
      id: "provider-switch", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    send({ role: "assistant", content: "Continued on the configured model." });send({}, "stop");response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert(address && typeof address !== "string");
  const networkFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "https://api.deepseek.com", "all model traffic is redirected to the local fixture");
    url.protocol = "http:";url.hostname = "127.0.0.1";url.port = String(address.port);
    return networkFetch(new Request(url, request));
  });
  const env = { PI_API_KEY: "fixture-only", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash", OPENROUTER_API_KEY: "unused-legacy-key" };
  const native = resolveNativeConfiguration({ harness: "pi", mode: "local", modelId: "openrouter/free", env });
  assert.equal(native.harness, "pi");if (native.harness !== "pi") throw new Error("Expected Pi");
  let checkpoint: { resumeFrom: HarnessAgentResumeSessionState; workspace: WorkspaceSnapshot } | undefined;
  const sessionId = randomUUID();
  try {
    for (const legacy of [true, false]) {
      const restored = legacy ? undefined : checkpoint; if (!legacy) assert(restored);
      const fs = restored ? await restoreWorkspace(JSON.parse(JSON.stringify(restored.workspace))) : await createDiskWorkspace();
      await fs.mkdir(`${fs.root}/project`, { recursive: true });
      const sandbox = await createLocalSandboxAdapter({ cwd: `${fs.root}/project`, env: {}, createFilesystem: async () => fs }).create({ sandboxId: randomUUID() });
      // Reproduce the old wire configuration only for the first attempt.
      const adapter: PiAdapterConfig = { ...native.adapter, reattachInProcess: false,
        model: { ...native.adapter.model, id: legacy ? "openrouter/free" : native.adapter.model.id } };
      const agent = createHarnessAgent(createPiAdapter(adapter), { tools: {}, instructions: "Continue the user's work.", sandboxConfig: { workDir: "work" } });
      try {
        const session = await agent.createSession({ sessionId, sandboxSession: sandbox.session, ...(restored ? { resumeFrom: restored.resumeFrom } : {}) });
        try {
          if (legacy) await assert.rejects(agent.generate({ session, prompt: "Original task before the configuration fix." }), /400|openrouter\/free/);
          else assert.equal((await agent.generate({ session, prompt: "Continue after the configuration fix." })).text, "Continued on the configured model.");
        } finally {
          const resumeFrom = await session.stop();
          if (legacy) checkpoint = { resumeFrom, workspace: await snapshotWorkspace(fs) };
          await session.destroy();
        }
      } finally { await sandbox.session.destroy(); }
    }
    assert.deepEqual(requests.map(request => request.model), ["openrouter/free", "deepseek-flash"]);
    const continued = JSON.stringify(requests[1].messages);
    assert(continued.includes("Original task before the configuration fix."), "cold resume retains prior user history");
    assert(continued.includes("Continue after the configuration fix."));
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
