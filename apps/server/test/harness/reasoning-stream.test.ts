import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { toUIMessageStream, type TextStreamPart, type ToolSet, type UIMessage, type UIMessageChunk } from "ai";
import { InMemoryFs } from "just-bash";
import type { HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { snapshotWorkspace, restoreWorkspace, type WorkspaceSnapshot } from "@tabdo/agent-runtime/workspace";
import { createHarnessAgent } from "@tabdo/platform-node/harness/agent";
import { createPiAdapter } from "@tabdo/platform-node/harness/pi";
import { createLocalSandboxAdapter } from "@tabdo/platform-node/sandbox/local";
import { createDatabase } from "@tabdo/backend/database";
import { resolveNativeConfiguration } from "@tabdo/backend/agent/runtime-configuration";
import { loadMessages, saveMessage } from "@tabdo/backend/chat/store";
import { user, organization, member, chatThreads } from "@tabdo/backend/schema";
import type { Actor } from "@tabdo/backend/auth/actor";

const connectionString = process.env.DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith("_agent_test")) throw new Error("Reasoning persistence fixture requires an isolated *_agent_test database");

test("native reasoning SSE becomes reasoning-delta and durable UI history without manufacturing missing reasoning", { timeout: 20000 }, async t => {
  const database = createDatabase({ connectionString, poolMax: 2 });
  const deps = { database: database.db, now: () => new Date(), uuid: randomUUID };
  const org = randomUUID(), owner = randomUUID();
  const actor: Actor = { kind: "human", userId: owner, memberId: owner, organizationId: org, role: "owner", name: "Reasoning fixture", email: `${owner}@local.test` };
  const requests: Record<string, unknown>[] = [];
  const provider = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
      id: "reasoning-fixture", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    if (requests.length === 1 || requests.length === 3) {
      send({ role: "assistant", reasoning_content: "Check the inputs. " });
      send({ reasoning_content: "Then verify the result." });
    }
    send({ role: "assistant", content: "Verified result." });
    send({}, "stop");
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const networkFetch = globalThis.fetch;
  // Preserve the real hostname so the native SDK exercises its DeepSeek policy;
  // only the transport is redirected, with every unexpected destination denied.
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "https://api.deepseek.com", "fixture must never make an external model request");
    url.protocol = "http:"; url.hostname = "127.0.0.1"; url.port = String(address.port);
    return networkFetch(new Request(url, request));
  });
  try {
    await database.db.insert(user).values({ id: owner, name: actor.name, email: actor.email });
    await database.db.insert(organization).values({ id: org, name: "Reasoning fixture", slug: org });
    await database.db.insert(member).values({ id: owner, userId: owner, organizationId: org, role: "owner" });
    const [thread] = await database.db.insert(chatThreads).values({ userId: owner, organizationId: org, clientId: randomUUID(), custom: {} }).returning();
    let cold: { resumeFrom: HarnessAgentResumeSessionState; workspace: WorkspaceSnapshot; sessionId: string } | undefined;
    for (const [index, level] of [undefined, "off", undefined, undefined].entries()) {
      const configuration = resolveNativeConfiguration({ harness: "pi", mode: "local", env: {
        PI_API_KEY: "fixture-key", PI_BASE_URL: "https://api.deepseek.com/v1", PI_MODEL: "deepseek-flash", PI_THINKING_LEVEL: level,
      } });
      assert.equal(configuration.harness, "pi"); if (configuration.harness !== "pi") throw new Error("Expected Pi");
      const restored = index === 2 ? cold : undefined;
      if (index === 2) assert(restored, "an actual native off journal must exist before cold resume");
      const fs = restored ? await restoreWorkspace(JSON.parse(JSON.stringify(restored.workspace))) : new InMemoryFs();
      await fs.mkdir("/project", { recursive: true });
      const sessionId = restored?.sessionId ?? randomUUID();
      const sandbox = await createLocalSandboxAdapter({ cwd: "/project", env: {}, createFilesystem: async () => fs }).create({ sandboxId: randomUUID() });
      const agent = createHarnessAgent(createPiAdapter({ ...configuration.adapter, reattachInProcess: false }), {
        instructions: "Respond to the user.", sandboxConfig: { workDir: "work" }, tools: {},
      });
      try {
        const session = await agent.createSession({ sandboxSession: sandbox.session, sessionId, ...(restored ? { resumeFrom: restored.resumeFrom } : {}) });
        try {
          const result = await agent.stream({ session, prompt: "Verify the inputs." });
          const nativeReasoning: string[] = [], chunks: UIMessageChunk[] = [];
          const stream = result.stream.pipeThrough(new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
            transform(part, controller) {
              if (part.type === "reasoning-delta") nativeReasoning.push(part.text);
              controller.enqueue(part);
            },
          }));
          const messageId = randomUUID();
          const ui = toUIMessageStream({ stream, tools: agent.tools, generateMessageId: () => messageId,
            onFinish: async ({ responseMessage }) => {
              await saveMessage(deps, thread.id, actor, { id: responseMessage.id, parentId: null, format: "ai-sdk/v6", content: { role: "assistant", parts: responseMessage.parts } }, true);
            },
          });
          for await (const chunk of ui) chunks.push(chunk);
          const expected = index === 0 || index === 2 ? "Check the inputs. Then verify the result." : "";
          assert.equal(nativeReasoning.join(""), expected);
          assert.equal(chunks.filter(chunk => chunk.type === "reasoning-delta").map(chunk => chunk.delta).join(""), expected);
          const history = await loadMessages(deps, thread.id, actor);
          const message = history.messages.find(message => message.id === messageId);
          assert(message, "native response is actually saved in PostgreSQL");
          const parts = message.content.parts as UIMessage["parts"];
          assert.equal(parts.filter(part => part.type === "reasoning").map(part => part.text).join(""), expected);
          assert.equal(parts.filter(part => part.type === "text").map(part => part.text).join(""), "Verified result.");
          if (index === 0 || index === 2) {
            assert.equal(requests[index].reasoning_effort, "medium", "SDK native default repairs previously forced-off sessions");
            assert.deepEqual(requests[index].thinking, { type: "enabled" });
          }
          if (index === 1) assert.deepEqual(requests[index].thinking, { type: "disabled" }, "only explicit off disables thinking");
        } finally {
          const resumeFrom = await session.stop();
          if (index === 1) {
            const workspace = await snapshotWorkspace(fs);
            const journal = workspace.filter(entry => entry.type === "file" && entry.path.endsWith(".jsonl"))
              .flatMap(entry => Buffer.from(entry.content!, "base64").toString("utf8").trim().split("\n").map(line => JSON.parse(line)));
            assert(journal.some(entry => entry.type === "thinking_level_change" && entry.thinkingLevel === "off"), "fixture saved a real native off journal");
            cold = { resumeFrom, workspace, sessionId };
          }
          await session.destroy();
        }
      } finally { await sandbox.session.destroy(); }
    }
  } finally {
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    await database.db.delete(organization).where(eq(organization.id, org));
    await database.db.delete(user).where(eq(user.id, owner));
    await database.close();
  }
});
