import "../../src/load-env.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { HarnessAgentSession } from "@ai-sdk/harness/agent";
import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import { SandboxCleanupError, SandboxConfigurationError } from "@tabdo/agent-runtime/sandbox/types";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { listRuntimeProviders } from "../../src/business/agent/sandbox-configuration.js";
import { sandboxProviderSchema } from "@tabdo/shared";
import { loadBuiltinSkillDocuments } from "../../src/skills/builtin-loader.js";

type ProviderRequest = { messages: { role: string; content: unknown }[]; tools?: { function: { name: string; parameters?: { properties?: Record<string, unknown> } } }[] };
const providerFlag = process.argv.indexOf("--provider");
const selectedProvider = sandboxProviderSchema.parse(providerFlag < 0 ? "vercel" : process.argv[providerFlag + 1]);
const credentialNames = ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID", "VERCEL_OIDC_TOKEN", "E2B_API_KEY", "E2B_TEMPLATE", "E2B_TIMEOUT_MS",
  "RAILWAY_API_TOKEN", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SANDBOX_ENVIRONMENT_ID", "RAILWAY_SANDBOX_CHECKPOINT", "RAILWAY_SANDBOX_REGION", "RAILWAY_SANDBOX_IDLE_MINUTES"] as const;
const credentials = Object.fromEntries(credentialNames.map(name => [name, process.env[name]?.trim() || undefined]));
const providerStatus = listRuntimeProviders(credentials).find(entry => entry.id === selectedProvider)!;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const redact = (value: string) => {
  for (const name of credentialNames) if (credentials[name]) value = value.replaceAll(credentials[name]!, "[redacted]");
  return value.slice(0, 2000);
};
const assertion = (error: unknown) => error instanceof assert.AssertionError ? redact(error.message) : error instanceof Error ? error.name : "unknown error";

async function main() {
  if (!providerStatus.available) {
    console.error(`[remote-smoke] BLOCKED ${selectedProvider}: ${providerStatus.hint}. No Sandbox was created; remote acceptance has not passed.`);
    process.exitCode = 2; return;
  }
  if (process.argv.includes("--preflight")) {
    console.log("[remote-smoke] READY: credential configuration is present. Preflight creates no resource and does not count as remote acceptance.");
    return;
  }
  if (process.env.HARNESS_REMOTE_SMOKE !== "1") {
    console.error("[remote-smoke] BLOCKED: set HARNESS_REMOTE_SMOKE=1 to explicitly create a real selected Sandbox. No remote acceptance was run.");
    process.exitCode = 2; return;
  }

  const sessionId = `remote-smoke-${randomUUID()}`, requestedSandboxId = `tabdo-smoke-${randomUUID()}`;
  const signal = AbortSignal.timeout(240_000);
  const report = loadBuiltinSkillDocuments().find((skill) => skill.name === "report");
  assert(report, "the production report bundle must exist");
  const script = report.files.find((file) => file.path === "scripts/summarize-csv.py");
  const reference = report.files.find((file) => file.path === "references/metrics.md");
  assert(script && reference, "use actual production script and reference files");
  const agents = "# AGENTS.md\n\nRemote smoke policy: remote-agents-marker. Run the production report CSV script once, then inspect preserved results.\n";
  const csv = "category,amount\nEast,10.5\nEast,3\nEast,\nWest,-2\nWest,\n,\n";
  const expected = [{ group: "", value: null, rows: 1 }, { group: "East", value: 13.5, rows: 3 }, { group: "West", value: -2, rows: 2 }];
  const firstReply = "Remote first turn complete", secondReply = "Remote history and files recovered without replay";
  const calls: ProviderRequest[] = [];
  const fixtureErrors: { call: number; error: Error }[] = [];
  const sandboxes = new Map<string, HarnessV1NetworkSandboxSession>();
  let session: HarnessAgentSession | undefined, workDir = "", skillDir = "", phase = "provider fixture startup";
  let passed = false, cleanupFailed = false;
  const outputCommand = () => `printf 'remote-report-json='; cat ${shellQuote(posix.join(workDir, "report-output.json"))}; printf 'remote-report-executions=1\\n'`;
  const verifyNativeOutput = (body: ProviderRequest) => {
    const contentText = (content: unknown): string => {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return content.map(contentText).join("\n");
      if (content && typeof content === "object" && "text" in content) return contentText(content.text);
      return "";
    };
    const texts = body.messages.filter((message) => message.role === "tool").map((message) => contentText(message.content));
    const output = texts.at(-1);
    assert(output, "real native bash output must reach the model");
    const match = output.match(/remote-report-json=(\[[^\r\n]+\])/);
    console.log(`[remote-smoke] report self-owned data ${JSON.stringify({ modelCall: calls.length, expected, actual: match ? redact(match[1]) : null,
      executionMarker: output.includes("remote-report-executions=1") })}`);
    assert(match, "the production script must emit its JSON result");
    assert.deepEqual(JSON.parse(match[1]), expected, "validate sums, nulls and row counts from the real Python script");
    assert(output.includes("remote-report-executions=1"), "the completed native command emits our own execution marker");
  };
  const provider = createServer(async (request, response) => {
    try {
      let raw = ""; for await (const chunk of request) raw += chunk;
      assert.equal(request.method, "POST"); assert(request.url?.endsWith("/chat/completions"));
      const body = JSON.parse(raw) as ProviderRequest; calls.push(body);
      const nth = calls.length, messages = JSON.stringify(body.messages);
      const pathArgument = (tool: "read" | "write", path: string) => {
        const properties = body.tools?.find(entry => entry.function.name === tool)?.function.parameters?.properties;
        const key = properties && ["path", "file_path"].find(key => key in properties);
        assert(key, `native ${tool} must advertise its file path argument`);
        return { [key]: path };
      };
      let name: "read" | "write" | "bash" | undefined, args: Record<string, unknown> = {};
      if (nth === 1) {
        const sandbox = sandboxes.values().next().value;
        assert(sandbox);
        const mountedSkill = await sandbox.readTextFile({ path: posix.join(skillDir, "SKILL.md"), abortSignal: signal });
        assert(mountedSkill?.includes(report.content), "SDK mounts the production Skill body before its first model request");
        assert.equal(await sandbox.readTextFile({ path: posix.join(skillDir, script.path), abortSignal: signal }), script.content, "the real Python script is mounted before the first model request");
        assert(messages.includes(report.name) && messages.includes(report.description), "production skill metadata reaches native provider");
        assert(!messages.includes("先明确报告给谁看") && !messages.includes("csv.DictReader"), "full production skill and script are read on demand through native tools");
        name = "read"; args = pathArgument(name, posix.join(workDir, "AGENTS.md"));
      }
      else if (nth === 2) { assert(messages.includes("remote-agents-marker")); name = "read"; args = pathArgument(name, posix.join(skillDir, "SKILL.md")); }
      else if (nth === 3) { assert(messages.includes("先明确报告给谁看")); name = "read"; args = pathArgument(name, posix.join(skillDir, reference.path)); }
      else if (nth === 4) { assert(messages.includes("统计口径")); name = "read"; args = pathArgument(name, posix.join(skillDir, script.path)); }
      else if (nth === 5) { assert(messages.includes("csv.DictReader")); name = "write"; args = { ...pathArgument(name, posix.join(workDir, "report-input.csv")), content: csv }; }
      else if (nth === 6) {
        name = "bash"; args = { command: `set -eu; command -v python3 >/dev/null; test ! -e ${shellQuote(posix.join(workDir, "report-count.txt"))}; python3 ${shellQuote(posix.join(skillDir, script.path))} ${shellQuote(posix.join(workDir, "report-input.csv"))} --group category --metric sum --value amount > ${shellQuote(posix.join(workDir, "report-output.json"))}; printf 'executed\\n' >> ${shellQuote(posix.join(workDir, "report-count.txt"))}; ${outputCommand()}`, timeout: 30 };
      }
      else if (nth === 7) { verifyNativeOutput(body); }
      else if (nth === 8) {
        assert(messages.includes(firstReply), "official native journal restores the first reply");
        assert(messages.includes("Run the production report skill"), "official native journal restores the first user prompt");
        assert(messages.includes("csv.DictReader") && messages.includes("统计口径"), "official native journal restores production script/reference reads");
        verifyNativeOutput(body);
        name = "bash"; args = { command: `set -eu; test "$(wc -l < ${shellQuote(posix.join(workDir, "report-count.txt"))})" -eq 1; ${outputCommand()}`, timeout: 30 };
      } else if (nth === 9) { verifyNativeOutput(body); }
      else throw new Error("unexpected extra native provider call");
      if (name) assert(body.tools?.some((entry) => entry.function.name === name), `native builtin ${name} must be available`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: `remote-${nth}`, object: "chat.completion.chunk", created: 1, model: "remote-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      send({ role: "assistant" });
      if (name) { send({ tool_calls: [{ index: 0, id: `remote-call-${nth}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }); send({}, "tool_calls"); }
      else { send({ content: nth === 7 ? firstReply : secondReply }); send({}, "stop"); }
      response.end("data: [DONE]\n\n");
    } catch (error) {
      fixtureErrors.push({ call: calls.length, error: error instanceof Error ? error : new Error("provider fixture failed") });
      response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "remote smoke fixture assertion failed" } }));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
    const address = provider.address(); assert(address && typeof address !== "string");
    // Pi runs in the host process. This isolated provider replaces paid model credentials.
    const env = { ...credentials, PI_API_KEY: "remote-local-fixture", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
    const makeAgent = () => createNativeAgent({ harness: "pi", mode: "sandbox", provider: selectedProvider, modelId: "remote-fixture", env,
      instructions: "Use the production report skill to verify actual remote CSV aggregation. Execute its Python script once, then inspect preserved output without repeating it.", agentsDocument: agents, tools: {},
      skills: [{ name: report.name, description: report.description, content: report.content, files: report.files }],
    });
    phase = `official ${selectedProvider} create`;
    const agent = makeAgent();
    const first = await openNativeSandbox({ agent, mode: "sandbox", provider: selectedProvider, sandboxId: requestedSandboxId, hasResumeState: false, signal, env });
    sandboxes.set(first.sandbox.id, first.sandbox); assert.equal(first.fs, undefined, "remote mode must not return the local virtual filesystem");
    if (selectedProvider === "vercel") assert.equal(first.sandbox.id, requestedSandboxId);
    else assert(first.sandbox.id && first.sandbox.id !== requestedSandboxId, "persist the provider-assigned real ID");
    console.log(`[remote-smoke] created ${selectedProvider} test Sandbox ${first.sandbox.id}`);
    phase = "remote contract and public port";
    const binary = new Uint8Array([0, 255, 127, 10]);
    await first.sandbox.writeBinaryFile({ path: "smoke-bytes.dat", content: binary, abortSignal: signal });
    assert.deepEqual(await first.sandbox.readBinaryFile({ path: "smoke-bytes.dat", abortSignal: signal }), binary);
    assert.equal(await first.sandbox.readBinaryFile({ path: "smoke-absent.dat", abortSignal: signal }), null);
    const failed = await first.sandbox.run({ command: "printf out; printf err >&2; exit 7", abortSignal: signal });
    assert.deepEqual(failed, { stdout: "out", stderr: "err", exitCode: 7 });
    const port = first.sandbox.ports[0];
    const web = await first.sandbox.spawn({ command: `node -e 'require("http").createServer((q,s)=>s.end("tabdo-0013-port")).listen(${port},"0.0.0.0")'`, abortSignal: signal });
    try {
      const endpoint = await first.sandbox.getPortEndpoint({ port, protocol: "http" });
      let reachable = false;
      for (let attempt = 0; attempt < 30 && !reachable; attempt++) {
        try { reachable = await (await fetch(endpoint.url, { headers: endpoint.headers, signal: AbortSignal.timeout(5000) })).text() === "tabdo-0013-port"; } catch {}
        if (!reachable) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      assert(reachable, "real published endpoint and required headers must reach the sandbox");
    } finally { await web.kill();await web.wait(); }
    phase = "remote shell environment";
    workDir = posix.join(first.sandbox.defaultWorkingDirectory, "agent");
    const home = await first.sandbox.run({ command: "printf '%s' \"$HOME\"", abortSignal: signal });
    assert.equal(home.exitCode, 0); assert(home.stdout.startsWith("/")); skillDir = posix.join(home.stdout.trim(), ".agents/skills/report");
    phase = "remote Python capability";
    const python = await first.sandbox.run({ command: `python3 -c 'import json,sys; print(json.dumps({"ok": True, "version": sys.version.split()[0]}))'`, abortSignal: signal });
    console.log(`[remote-smoke] Python execution probe ${JSON.stringify({ exitCode: python.exitCode, stdout: redact(python.stdout), stderr: redact(python.stderr) })}`);
    if (python.exitCode !== 0) {
      console.error("[remote-smoke] FAILED: python3 did not execute successfully; an installed shim does not prove a usable Python runtime. No packages were installed. Remote acceptance has not passed.");
      throw new Error("Remote Python capability unavailable");
    }
    assert.equal(JSON.parse(python.stdout.trim()).ok, true, "real Python probe must execute and emit the expected JSON");
    phase = "official native first turn";
    session = await agent.createSession({ sessionId, sandboxSession: first.sandbox, abortSignal: signal });
    phase = "verify SDK-mounted AGENTS";
    assert.equal(await first.sandbox.readTextFile({ path: posix.join(workDir, "AGENTS.md"), abortSignal: signal }), agents, "SDK workDir contains the exact test AGENTS document");
    console.log(`[remote-smoke] mounted test paths ${JSON.stringify({ workDir, skillDir })}`);
    phase = "official native first turn";
    const firstResult = await agent.generate({ session, prompt: "Run the production report skill on the fixture CSV and preserve its results", abortSignal: signal });
    console.log(`[remote-smoke] first turn self-owned reply ${JSON.stringify({ expected: firstReply, actual: redact(firstResult.text), modelCalls: calls.length })}`);
    assert.equal(firstResult.text, firstReply);
    assert.equal(calls.length, 7); assert.equal(fixtureErrors.length, 0);
    const read = async (sandbox: HarnessV1NetworkSandboxSession, path: string) => {
      const bytes = await sandbox.readBinaryFile({ path, abortSignal: signal }); assert(bytes); return Buffer.from(bytes).toString("utf8");
    };
    assert.equal(await read(first.sandbox, posix.join(workDir, "AGENTS.md")), agents);
    assert.equal(await read(first.sandbox, posix.join(workDir, "report-input.csv")), csv);
    assert.equal(await read(first.sandbox, posix.join(skillDir, script.path)), script.content);
    assert.equal(await read(first.sandbox, posix.join(skillDir, reference.path)), reference.content);
    const firstOutput = await read(first.sandbox, posix.join(workDir, "report-output.json"));
    assert.deepEqual(JSON.parse(firstOutput), expected);
    assert.equal(await read(first.sandbox, posix.join(workDir, "report-count.txt")), "executed\n");
    phase = "official session stop and sandbox stop";
    const resume = await session.stop(); session = undefined;
    assert(!resume.continueFrom, "first turn must finish before resume");
    await first.sandbox.stop();
    if (selectedProvider === "railway") console.log("[remote-smoke] released Railway handle execs and heartbeat; VM is not paused and remains billable until idle expiry or destroy");
    phase = `official ${selectedProvider} resume lookup`;
    const nextAgent = makeAgent();
    const second = await openNativeSandbox({ agent: nextAgent, mode: "sandbox", provider: selectedProvider, sandboxId: first.sandbox.id, hasResumeState: true, signal, env });
    sandboxes.set(second.sandbox.id, second.sandbox); assert.equal(second.sandbox.id, first.sandbox.id); assert.equal(second.fs, undefined);
    assert.equal(await read(second.sandbox, posix.join(workDir, "report-count.txt")), "executed\n", "remote file survives handle release and same-ID reconnect");
    assert.equal(await read(second.sandbox, posix.join(workDir, "report-input.csv")), csv);
    assert.equal(await read(second.sandbox, posix.join(workDir, "report-output.json")), firstOutput);
    assert.equal(await read(second.sandbox, posix.join(skillDir, script.path)), script.content);
    phase = "official native resumed turn";
    session = await nextAgent.createSession({ sessionId, sandboxSession: second.sandbox, resumeFrom: resume, abortSignal: signal });
    assert(!session.hasUnfinishedTurn());
    assert.equal((await nextAgent.generate({ session, prompt: "Inspect the existing report output without repeating the Python script", abortSignal: signal })).text, secondReply);
    assert.equal(calls.length, 9); assert.equal(fixtureErrors.length, 0);
    assert.equal(await read(second.sandbox, posix.join(workDir, "report-count.txt")), "executed\n", "official resume does not replay the script side effect");
    assert.equal(await read(second.sandbox, posix.join(workDir, "report-output.json")), firstOutput);
    await session.stop(); session = undefined; passed = true;
  } catch (error) {
    // SDK error payloads can include request details. Do not print credentials or raw stacks.
    console.error(`[remote-smoke] FAILED during ${phase} (${error instanceof Error ? error.name : "unknown error"}). Remote acceptance has not passed.`);
    console.error(`[remote-smoke] diagnostic ${JSON.stringify({ phase, modelCalls: calls.length, assertion: assertion(error), fixtureErrors: fixtureErrors.map(({ call, error }) => ({ call, assertion: assertion(error) })) })}`);
    if (error instanceof SandboxCleanupError) console.error(`[remote-smoke] cleanup failed for newly created test Sandbox ${error.sandboxId}; remove this test resource manually.`);
    process.exitCode = 1;
  } finally {
    try { await session?.destroy(); } catch { cleanupFailed = true; console.error("[remote-smoke] native session cleanup failed"); }
    for (const sandbox of sandboxes.values()) {
      try {
        await sandbox.destroy(); console.log(`[remote-smoke] destroyed test Sandbox ${sandbox.id}`);
        if (selectedProvider === "railway") {
          const probeAgent = createNativeAgent({ harness: "pi", mode: "sandbox", provider: selectedProvider, modelId: "destroyed-probe", env: {
            ...credentials, PI_API_KEY: "fixture-only", PI_BASE_URL: "http://127.0.0.1:1/v1",
          }, instructions: "No model turn is invoked.", tools: {}, skills: [] });
          await assert.rejects(openNativeSandbox({ agent: probeAgent, mode: "sandbox", provider: selectedProvider,
            sandboxId: sandbox.id, hasResumeState: true, env: credentials, signal: AbortSignal.timeout(30_000) }),
          error => error instanceof SandboxConfigurationError && error.message.includes("requires RUNNING") || error instanceof Error && error.name === "SandboxNotFoundError");
          console.log(`[remote-smoke] destroyed Railway Sandbox ${sandbox.id} cannot resume; no replacement was created`);
        }
      }
      catch { cleanupFailed = true; console.error(`[remote-smoke] cleanup failed for test Sandbox ${sandbox.id}; remove this test resource manually.`); }
    }
    provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(join(tmpdir(), "ai-sdk-harness", "pi", sessionId), { recursive: true, force: true });
    if (cleanupFailed) process.exitCode = 1;
  }
  if (passed && !cleanupFailed) console.log(`[remote-smoke] PASS real ${selectedProvider} Sandbox: native read/write/bash, AGENTS + production report Skill/reference/Python script, real CSV sum/null/row-count JSON, ${selectedProvider === "railway" ? "handle release / RUNNING VM reconnect" : "stop / same-ID resume"}, persisted native history/files/output, script executed once, test resource destroyed. Model provider was a local deterministic fixture; no paid model or application database was used.`);
}

await main();
