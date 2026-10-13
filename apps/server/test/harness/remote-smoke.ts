import "../../src/load-env.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import type { HarnessAgentSession } from "@ai-sdk/harness/agent";
import type { HarnessV1NetworkSandboxSession } from "@ai-sdk/harness";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { loadBuiltinSkillDocuments } from "../../src/skills/builtin-loader.js";

type ProviderRequest = { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] };
const credentialNames = ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID", "VERCEL_OIDC_TOKEN"] as const;
const credentials = Object.fromEntries(credentialNames.map((name) => [name, process.env[name]?.trim() || undefined]));
const credentialReady = Boolean(credentials.VERCEL_OIDC_TOKEN || (credentials.VERCEL_TOKEN && credentials.VERCEL_TEAM_ID && credentials.VERCEL_PROJECT_ID));
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function main() {
  if (!credentialReady) {
    console.error("[remote-smoke] BLOCKED: configure VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID, or VERCEL_OIDC_TOKEN. No Sandbox was created; remote acceptance has not passed.");
    process.exitCode = 2; return;
  }
  if (process.argv.includes("--preflight")) {
    console.log("[remote-smoke] READY: credential configuration is present. Preflight creates no resource and does not count as remote acceptance.");
    return;
  }
  if (process.env.HARNESS_REMOTE_SMOKE !== "1") {
    console.error("[remote-smoke] BLOCKED: set HARNESS_REMOTE_SMOKE=1 to explicitly create a real Vercel Sandbox. No remote acceptance was run.");
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
  const fixtureErrors: Error[] = [];
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
    assert(match, "the production script must emit its JSON result");
    assert.deepEqual(JSON.parse(match[1]), expected, "validate sums, nulls and row counts from the real Python script");
    assert(output.includes("remote-report-executions=1") && output.includes("(exit 0)"));
  };
  const provider = createServer(async (request, response) => {
    try {
      let raw = ""; for await (const chunk of request) raw += chunk;
      assert.equal(request.method, "POST"); assert(request.url?.endsWith("/chat/completions"));
      const body = JSON.parse(raw) as ProviderRequest; calls.push(body);
      const nth = calls.length, messages = JSON.stringify(body.messages);
      let name: "read" | "write" | "bash" | undefined, args: Record<string, unknown> = {};
      if (nth === 1) {
        assert(messages.includes(report.name) && messages.includes(report.description), "production skill metadata reaches native provider");
        assert(!messages.includes("先明确报告给谁看") && !messages.includes("csv.DictReader"), "full production skill and script are read on demand through native tools");
        name = "read"; args = { file_path: posix.join(workDir, "AGENTS.md") };
      }
      else if (nth === 2) { assert(messages.includes("remote-agents-marker")); name = "read"; args = { file_path: posix.join(skillDir, "SKILL.md") }; }
      else if (nth === 3) { assert(messages.includes("先明确报告给谁看")); name = "read"; args = { file_path: posix.join(skillDir, reference.path) }; }
      else if (nth === 4) { assert(messages.includes("统计口径")); name = "read"; args = { file_path: posix.join(skillDir, script.path) }; }
      else if (nth === 5) { assert(messages.includes("csv.DictReader")); name = "write"; args = { file_path: posix.join(workDir, "report-input.csv"), content: csv }; }
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
      fixtureErrors.push(error instanceof Error ? error : new Error("provider fixture failed"));
      response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "remote smoke fixture assertion failed" } }));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve); });
    const address = provider.address(); assert(address && typeof address !== "string");
    // Pi runs in the host process. This isolated provider replaces paid model credentials.
    const env = { ...credentials, PI_API_KEY: "remote-local-fixture", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
    const makeAgent = () => createNativeAgent({ harness: "pi", mode: "sandbox", modelId: "remote-fixture", env,
      instructions: "Use the production report skill to verify actual remote CSV aggregation. Execute its Python script once, then inspect preserved output without repeating it.", agentsDocument: agents, tools: {},
      skills: [{ name: report.name, description: report.description, content: report.content, files: report.files }],
    });
    phase = "official Vercel create";
    const agent = makeAgent();
    const first = await openNativeSandbox({ agent, mode: "sandbox", sandboxId: requestedSandboxId, hasResumeState: false, signal, env });
    sandboxes.set(first.sandbox.id, first.sandbox); assert.equal(first.fs, undefined, "remote mode must not return the local virtual filesystem");
    assert.equal(first.sandbox.id, requestedSandboxId);
    phase = "remote shell environment";
    workDir = posix.join(first.sandbox.defaultWorkingDirectory, "agent");
    const home = await first.sandbox.run({ command: "printf '%s' \"$HOME\"", abortSignal: signal });
    assert.equal(home.exitCode, 0); assert(home.stdout.startsWith("/")); skillDir = posix.join(home.stdout.trim(), ".agents/skills/report");
    phase = "remote Python capability";
    const python = await first.sandbox.run({ command: "command -v python3", abortSignal: signal });
    if (python.exitCode !== 0) {
      console.error("[remote-smoke] FAILED: the real node24 Sandbox has no python3; the production report script was not executed. No packages were installed. Remote acceptance has not passed.");
      throw new Error("Remote Python capability unavailable");
    }
    phase = "official native first turn";
    session = await agent.createSession({ sessionId, sandboxSession: first.sandbox, abortSignal: signal });
    assert.equal((await agent.generate({ session, prompt: "Run the production report skill on the fixture CSV and preserve its results", abortSignal: signal })).text, firstReply);
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
    assert(!resume.continueFrom, "first turn must finish before resume"); assert((resume.data as { sessionFileName?: string }).sessionFileName);
    await first.sandbox.stop();
    phase = "official Vercel resume lookup";
    const nextAgent = makeAgent();
    const second = await openNativeSandbox({ agent: nextAgent, mode: "sandbox", sandboxId: first.sandbox.id, hasResumeState: true, signal, env });
    sandboxes.set(second.sandbox.id, second.sandbox); assert.equal(second.sandbox.id, first.sandbox.id); assert.equal(second.fs, undefined);
    assert.equal(await read(second.sandbox, posix.join(workDir, "report-count.txt")), "executed\n", "remote file survives actual stopped Sandbox resume");
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
    process.exitCode = 1;
  } finally {
    try { await session?.destroy(); } catch { cleanupFailed = true; console.error("[remote-smoke] native session cleanup failed"); }
    for (const sandbox of sandboxes.values()) {
      try { await sandbox.destroy(); console.log(`[remote-smoke] destroyed test Sandbox ${sandbox.id}`); }
      catch { cleanupFailed = true; console.error(`[remote-smoke] cleanup failed for test Sandbox ${sandbox.id}; remove this test resource manually.`); }
    }
    provider.closeAllConnections(); await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(join(tmpdir(), "ai-sdk-harness", "pi", sessionId), { recursive: true, force: true });
    if (cleanupFailed) process.exitCode = 1;
  }
  if (passed && !cleanupFailed) console.log("[remote-smoke] PASS real Vercel Sandbox: native read/write/bash, AGENTS + production report Skill/reference/Python script, real CSV sum/null/row-count JSON, stopped Sandbox lookup/resume, persisted native history/files/output, script executed once, test resource destroyed. Model provider was a local deterministic fixture; no paid model or application database was used.");
}

await main();
