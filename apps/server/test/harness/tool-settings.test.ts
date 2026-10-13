import { createServer } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { tool, type TextStreamPart, type ToolSet } from "ai";
import { z } from "zod";
import { BUILTIN_TOOL_IDS, DISABLED_TOOLS_SCHEMA, PLATFORM_TOOL_IDS } from "@tabdo/shared";
import { getAgentToolCatalog, validateDisabledTools } from "../../src/harness/tool-catalog.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { nativeHostTools, nativeToolDenial } from "../../src/harness/tools.js";

test("catalog matches installed adapters and validates native compatibility", () => {
  const builtinIds = new Set<string>();
  for (const harness of ["pi", "codex", "claude"] as const) {
    const catalog = getAgentToolCatalog(harness);
    assert.equal(catalog.supportsFiltering, true);
    assert.deepEqual(catalog.tools.filter(t => t.source === "platform").map(t => t.id).sort(), [...PLATFORM_TOOL_IDS].sort());
    for (const item of catalog.tools) {
      assert(DISABLED_TOOLS_SCHEMA.safeParse([item.id]).success, `shared schema includes ${harness}/${item.id}`);
      assert(item.supportedHarnesses.includes(harness));
      if (item.source === "builtin") builtinIds.add(item.id);
    }
    assert.deepEqual(validateDisabledTools(harness, []), []);
    assert.deepEqual(validateDisabledTools(harness, ["update_plan", "bash"]), ["update_plan", "bash"]);
  }
  assert.deepEqual([...builtinIds].sort(), [...BUILTIN_TOOL_IDS].sort());
  assert.throws(() => validateDisabledTools("pi", ["webSearch"]), /不属于/);
  assert.throws(() => validateDisabledTools("codex", ["read"]), /不属于/);
  assert.throws(() => validateDisabledTools("pi", ["unknown"]), /未知/);
});

test("actual Pi filters native and host tools and denies a forced disabled call before execute", async () => {
  const calls: { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[] = [];
  let executed = 0;
  const provider = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "tools-filter", object: "chat.completion.chunk", created: 1, model: "test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant" });
    if (calls.length === 1) {
      send({ tool_calls: [
        { index: 0, id: "disabled-write", type: "function", function: { name: "update_cell", arguments: "{}" } },
        { index: 1, id: "disabled-bash", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "printf forbidden > /workspace/forbidden.txt" }) } },
        { index: 2, id: "disabled-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "/workspace/secret.txt" }) } },
      ] });
      send({}, "tool_calls");
    } else { send({ content: "工具已关闭，未执行修改。" }); send({}, "stop"); }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address(); assert(address && typeof address !== "string");
  const env = { PI_API_KEY: "test", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const wrapped = nativeHostTools({ update_cell: tool({ inputSchema: z.object({}), execute: () => { executed++; return { ok: true }; } }) }, async execute => execute());
  const agent = createNativeAgent({ harness: "pi", mode: "local", env, modelId: "test", instructions: "Use available tools only.", tools: wrapped.tools, skills: [], disabledTools: ["update_cell", "read", "bash"] });
  let sandbox: Awaited<ReturnType<typeof openNativeSandbox>>["sandbox"] | undefined;
  let session: Awaited<ReturnType<typeof agent.createSession>> | undefined;
  try {
    const opened = await openNativeSandbox({ agent, mode: "local", sandboxId: "tool-settings-proof", hasResumeState: false, env });
    sandbox = opened.sandbox;
    assert(opened.fs);
    await opened.fs.writeFile("/workspace/secret.txt", "native-filter-secret");
    session = await agent.createSession({ sessionId: "tool-settings-session", sandboxSession: sandbox });
    const result = await agent.stream({ session, prompt: "确认工具设置" });
    const parts: TextStreamPart<ToolSet>[] = [];
    for await (const part of result.stream.pipeThrough(wrapped.projectErrors())) parts.push(part);
    assert.equal(executed, 0);
    const sentNames = calls[0].tools?.map(t => t.function.name) ?? [];
    for (const name of ["update_cell", "read", "bash"]) assert(!sentNames.includes(name), `${name} is absent from the actual provider catalog`);
    assert(sentNames.includes("write"), "other native tools remain enabled");
    assert(!opened.fs.getAllPaths().includes("/workspace/forbidden.txt"), "disabled native bash cannot mutate the virtual workspace");
    const toolMessages = calls[1].messages.filter(m => m.role === "tool");
    assert.equal(toolMessages.length, 3);
    assert.match(JSON.stringify(toolMessages), /Tool bash not found/);
    assert.match(JSON.stringify(toolMessages), /Tool read not found/);
    assert(!JSON.stringify(toolMessages).includes("native-filter-secret"), "disabled native read cannot return file content");
    const correction = calls[1].messages.find(m => m.role === "tool");
    assert(correction, "provider receives a correction result");
    assert.match(JSON.stringify(correction.content), /execution-denied|not active|denied|not allowed|disabled|not found/i);
    assert(parts.some(part => part.type === "tool-error" && part.toolName === "update_cell"));
    assert(parts.some(part => part.type === "text-delta" && part.text.includes("工具已关闭")));
    assert(nativeToolDenial({ type: "execution-denied", reason: "disabled" }));
    assert.equal(nativeToolDenial({ ok: true }), undefined);
  } finally {
    await session?.stop(); await sandbox?.stop();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
});
