import { createServer } from "node:http";
import assert from "node:assert/strict";
import { snapshotWorkspace } from "../../src/harness/workspace.js";
import {
  createNativeAgent,
  openNativeSandbox,
} from "../../src/harness/runtime.js";
import { test } from "node:test";
import { tool } from "ai";
import { z } from "zod";
test("native Pi tool loop and persisted virtual workspace resume", async () => {
  const calls: { messages: { role: string; content: unknown }[] }[] = [];
  let executed = 0;
  const http = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    calls.push(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "test",
            object: "chat.completion.chunk",
            created: 1,
            model: "local-test",
            choices: [{ index: 0, delta, finish_reason }],
          }) +
          "\n\n",
      );
    send({ role: "assistant" });
    if (calls.length === 1) {
      send({
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "get_fixture", arguments: "{}" },
          },
        ],
      });
      send({}, "tool_calls");
    } else {
      send({
        content: calls.length === 2 ? "工具执行后正常回复" : "原生会话续接正常",
      });
      send({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const address = http.address();
  assert(address && typeof address !== "string");
  const env = {
    PI_API_KEY: "test-key",
    PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  };
  const makeAgent = () =>
    createNativeAgent({
      harness: "pi",
      mode: "local",
      env,
      modelId: "local-test",
      instructions: "Use get_fixture once, then respond in text.",
      agentsDocument:
        "# Workspace policy\n\nVerify fixture results before replying.",
      skills: [
        {
          name: "fixture",
          description: "Read fixture data",
          content: "Use fixture tools to verify the data.",
          files: [
            { path: "references/fixture.md", content: "fixture-reference" },
          ],
        },
      ],
      tools: {
        get_fixture: tool({
          inputSchema: z.object({}),
          execute: () => {
            executed++;
            return { ok: true };
          },
        }),
      },
    });
  try {
    const agent = makeAgent();
    const { sandbox, fs } = await openNativeSandbox({
      agent,
      mode: "local",
      sandboxId: "fixture-sandbox",
      hasResumeState: false,
      env,
    });
    assert(fs);
    const session = await agent.createSession({
      sessionId: "fixture-session",
      sandboxSession: sandbox,
    });
    const result = await agent.generate({
      session,
      prompt: "读取fixture并回答",
    });
    assert.equal(result.text, "工具执行后正常回复");
    assert.equal(executed, 1);
    assert.equal(
      await fs.readFile("/workspace/agent/AGENTS.md"),
      "# Workspace policy\n\nVerify fixture results before replying.",
    );
    assert.ok(
      fs.getAllPaths().some((p) => p.endsWith("references/fixture.md")),
      "native skills materialize reference files",
    );
    assert.ok(
      !JSON.stringify(await snapshotWorkspace(fs)).includes("test-key"),
      "model credentials are not workspace files",
    );
    const resume = await session.stop();
    const paths = fs.getAllPaths();
    assert.ok(
      paths.some((p) => p.includes(".jsonl")),
      "native journal saved",
    );
    const snapshot = await snapshotWorkspace(fs);
    await sandbox.stop();
    const agent2 = makeAgent();
    const { sandbox: sandbox2 } = await openNativeSandbox({
      agent: agent2,
      mode: "local",
      sandboxId: "fixture-sandbox",
      hasResumeState: true,
      workspace: snapshot,
      env,
    });
    const session2 = await agent2.createSession({
      sessionId: "fixture-session",
      sandboxSession: sandbox2,
      resumeFrom: resume,
    });
    const result2 = await agent2.generate({
      session: session2,
      prompt: "继续上一轮",
    });
    assert.equal(result2.text, "原生会话续接正常");
    assert.ok(
      JSON.stringify(calls.at(-1)?.messages).includes("工具执行后正常回复"),
      "provider sees native persisted history",
    );
    await session2.stop();
    await sandbox2.stop();
    console.log(
      "PASS actual HarnessAgent/Pi: native host tool loop, final text, virtual workspace snapshot, new sandbox+agent resume retaining native journal.",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      http.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
