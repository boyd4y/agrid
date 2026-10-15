import { createServer } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { tool, type TextStreamPart, type ToolSet } from "ai";
import { z } from "zod";
import { DISABLED_TOOLS_SCHEMA, PLATFORM_TOOL_IDS } from "@tabdo/shared";
import { getAgentToolCatalog, validateDisabledTools } from "../../src/harness/tool-catalog.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { nativeHostTools, nativeToolDenial } from "../../src/harness/tools.js";

test("catalog lists only platform tools and normalizes old native/task settings", () => {
  for (const harness of ["pi", "codex", "claude"] as const) {
    const catalog = getAgentToolCatalog(harness);
    assert.equal(catalog.supportsFiltering, true);
    assert(catalog.tools.every(item => item.source === "platform"));
    assert.deepEqual(catalog.tools.map(item => item.id).sort(), [...PLATFORM_TOOL_IDS].sort());
    for (const item of catalog.tools) {
      assert(DISABLED_TOOLS_SCHEMA.safeParse([item.id]).success);
      assert(item.supportedHarnesses.includes(harness));
    }
    assert.deepEqual(validateDisabledTools(harness, []), []);
    assert.deepEqual(validateDisabledTools(harness, ["update_cell", "read_skill", "bash", "read", "webSearch", "create_goal", "update_goal", "update_plan", "get_task_state"]), ["update_cell"]);
    assert.throws(() => validateDisabledTools(harness, ["unknown"]), /未知/);
    assert.throws(() => validateDisabledTools(harness, ["update_cell", "update_cell"]), /重复/);
  }
});

test("actual Pi keeps native tools enabled with legacy settings while disabled platform writes remain denied", async () => {
  const calls: { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[] = [];
  let executed = 0, workspaceRoot = "";
  const provider = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "tools-filter", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant" });
    if (calls.length === 1) {
      send({ tool_calls: [
        { index: 0, id: "disabled-write", type: "function", function: { name: "update_cell", arguments: "{}" } },
        { index: 1, id: "native-bash", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `printf native > '${workspaceRoot}/workspace/native.txt'` }) } },
        { index: 2, id: "native-read", type: "function", function: { name: "read", arguments: JSON.stringify({ file_path: `${workspaceRoot}/workspace/agent/secret.txt` }) } },
      ] });
      send({}, "tool_calls");
    } else { send({ content: "工具已关闭，未执行修改。" }); send({}, "stop"); }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const env = { PI_API_KEY: "test", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const wrapped = nativeHostTools({ update_cell: tool({ inputSchema: z.object({}), execute: () => { executed++; return { ok: true }; } }) }, async execute => execute());
  const agent = createNativeAgent({ harness: "pi", mode: "local", env, modelId: "test", instructions: "Use available tools only.", tools: wrapped.tools, skills: [], disabledTools: ["update_cell", "read", "bash", "create_goal", "update_goal", "update_plan", "get_task_state"] });
  let sandbox: Awaited<ReturnType<typeof openNativeSandbox>>["sandbox"] | undefined;
  let session: Awaited<ReturnType<typeof agent.createSession>> | undefined;
  try {
    const opened = await openNativeSandbox({ agent, mode: "local", sandboxId: "tool-settings-proof", hasResumeState: false, env });
    sandbox = opened.sandbox;
    assert(opened.fs);
    workspaceRoot = opened.fs.root;
    await opened.fs.mkdir(`${workspaceRoot}/workspace/agent`, { recursive: true });
    await opened.fs.writeFile(`${workspaceRoot}/workspace/agent/secret.txt`, "native-filter-secret");
    session = await agent.createSession({ sessionId: "tool-settings-session", sandboxSession: sandbox });
    const result = await agent.stream({ session, prompt: "确认工具设置" });
    const parts: TextStreamPart<ToolSet>[] = [];
    for await (const part of result.stream.pipeThrough(wrapped.projectErrors())) parts.push(part);
    assert.equal(executed, 0);
    const sentNames = calls[0].tools?.map(t => t.function.name) ?? [];
    for (const name of ["update_cell", "create_goal", "update_goal", "update_plan", "get_task_state"]) assert(!sentNames.includes(name), `${name} is absent from the actual provider catalog`);
    for (const name of ["read", "bash", "askUserQuestions"]) assert(sentNames.includes(name), `${name} stays native and enabled`);
    assert(sentNames.includes("write"), "other native tools remain enabled");
    assert.equal(await opened.fs.readFile(`${workspaceRoot}/workspace/native.txt`), "native", "native bash executes despite the old disabled entry");
    const toolMessages = calls[1].messages.filter(m => m.role === "tool");
    assert.equal(toolMessages.length, 3);
    assert(JSON.stringify(toolMessages).includes("native-filter-secret"), "native read stays available independently of platform settings: " + JSON.stringify(toolMessages));
    const correction = calls[1].messages.find(m => m.role === "tool");
    assert(correction, "provider receives a correction result");
    assert.match(JSON.stringify(correction.content), /execution-denied|not active|denied|not allowed|disabled|not found/i);
    assert(parts.some(part => part.type === "tool-error" && part.toolName === "update_cell"));
    assert(parts.some(part => part.type === "text-delta" && part.text.includes("工具已关闭")));
    assert(nativeToolDenial({ type: "execution-denied", reason: "disabled" }));
    assert.equal(nativeToolDenial({ ok: true }), undefined);
  } finally {
    await session?.stop(); await sandbox?.destroy();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
});
