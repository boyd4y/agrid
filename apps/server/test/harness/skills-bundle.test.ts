import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { stepCountIs } from "ai";
import { loadBuiltinSkillDocuments } from "../../src/skills/builtin-loader.js";
import { snapshotWorkspace } from "../../src/harness/workspace.js";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";

test("real builtin skill bundles load progressively through official Pi read/bash, with real Python, Node, binary files and isolated process environment", { timeout: 25000 }, async () => {
  const bundles = loadBuiltinSkillDocuments();
  assert.deepEqual(bundles.map((skill) => skill.name), ["automation", "form", "report", "site", "table"]);
  const report = bundles.find((skill) => skill.name === "report")!;
  const script = report.files.find((file) => file.path === "scripts/summarize-csv.py")!;
  assert(script);
  let mountedRoot = "";
  let mountedFs: Awaited<ReturnType<typeof openNativeSandbox>>["fs"];
  const requests: { messages: { role: string; content: unknown }[]; tools: { function: { name: string; parameters: { properties: Record<string, unknown> } } }[] }[] = [];
  const http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    mountedRoot ||= mountedFs!.getAllPaths().find((path) => path.endsWith("/report/SKILL.md"))!.replace(/\/report\/SKILL.md$/, "");
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "skills-fixture", object: "chat.completion.chunk", created: 1, model: "local-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant" });
    let name = "read", args: Record<string, string> = {};
    const readProperties = body.tools.find((entry: { function: { name: string } }) => entry.function.name === "read")?.function.parameters.properties;
    if (requests.length <= 2 || requests.length === 7) args = { [readProperties?.path ? "path" : "file_path"]: `${mountedRoot}/report/${requests.length === 1 ? "SKILL.md" : "scripts/summarize-csv.py"}` };
    else if (requests.length === 3) { name = "bash"; args = { command: `cat '${mountedRoot}/report/references/metrics.md'` }; }
    else if (requests.length === 4) { name = "bash"; args = { command: `python3 '${mountedRoot}/report/scripts/summarize-csv.py' '${mountedFs!.root}/workspace/input.csv' --group category --metric sum --value amount` }; }
    else if (requests.length === 5) { name = "bash"; args = { command: `node '${mountedFs!.root}/workspace/node-proof.cjs' '${mountedFs!.root}/workspace/node-proof.bin'` }; }
    else { send({ content: "Read report references; Python and Node scripts executed." }); send({}, "stop"); res.end("data: [DONE]\n\n"); return; }
    send({ tool_calls: [{ index: 0, id: `skill_${requests.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }); send({}, "tool_calls"); res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); assert(address && typeof address !== "string");
  const env = { PI_API_KEY: "local-skills-fixture", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
  const agent = createNativeAgent({ harness: "pi", mode: "local", env, modelId: "local-test", instructions: "Inspect skills only when needed. Execute the actual bundled script and verify real file results.", skills: bundles.map(({ name, description, content, files }) => ({ name, description, content, files })), tools: {}, stopWhen: stepCountIs(10) });
  const opened = await openNativeSandbox({ agent, mode: "local", sandboxId: `skill-sandbox-${randomUUID()}`, hasResumeState: false, env }); assert(opened.fs);
  const session = await agent.createSession({ sessionId: `skill-bundle-${randomUUID()}`, sandboxSession: opened.sandbox });
  mountedFs = opened.fs;
  await opened.fs.writeFile(`${opened.fs.root}/workspace/input.csv`, "category,amount\nA,1.25\nA,-0.25\nB,\n");
  await opened.fs.writeFile(`${opened.fs.root}/workspace/node-proof.cjs`, `const fs = require("node:fs");fs.writeFileSync(process.argv[2], Buffer.from([0,1,127,255]));console.log("native-node-ok", JSON.stringify({node:process.versions.node,cwd:process.cwd(),secretNames:Object.keys(process.env).filter(name=>/^(DATABASE_URL|PGPASSWORD|PI_API_KEY|OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)$/.test(name))}));`);
  try {
    assert.equal((await agent.generate({ session, prompt: "Inspect the report skill and available script environment." })).text, "Read report references; Python and Node scripts executed.");
    const initial = JSON.stringify(requests[0].messages);
    for (const bundle of bundles) {
      assert(initial.includes(bundle.name) && initial.includes(bundle.description));
      const bodyParagraph = bundle.content.split("\n").find((line) => line.length > 60)!;
      assert(!initial.includes(bodyParagraph), "full skill body is loaded on demand, not placed in initial instructions");
      const mountedDocument = await opened.fs.readFile(`${mountedRoot}/${bundle.name}/SKILL.md`);
      assert(mountedDocument.includes(bundle.content));
      for (const file of bundle.files) assert.equal(await opened.fs.readFile(`${mountedRoot}/${bundle.name}/${file.path}`), file.content);
    }
    const toolText = (index: number) => requests[index].messages.filter((message) => message.role === "tool").map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n");
    assert(toolText(1).includes(report.content), "official native read obtains full report instructions");
    assert(toolText(2).includes(script.content), "official native read obtains actual complete bundled script");
    const reference = report.files.find((file) => file.path === "references/metrics.md")!;
    assert(toolText(3).includes(reference.content), "native bash executes against the mounted reference files");
    const pythonResult = requests[4].messages.filter((message) => message.role === "tool").at(-1);
    assert(pythonResult);
    const output = typeof pythonResult.content === "string" ? pythonResult.content : JSON.stringify(pythonResult.content);
    assert.match(output, /"group":\s*"A"/);assert.match(output, /"value":\s*1(?:\.0)?/);
    assert(!/command not found|Traceback/.test(output), "the bundled Python script executes, rather than a simulated missing-interpreter response");
    const nodeOutput = toolText(5);
    assert(nodeOutput.includes("native-node-ok"));assert(nodeOutput.includes('"secretNames":[]'), "real child processes do not inherit database/model credentials");
    assert(nodeOutput.includes(opened.fs.root), "the real Node process runs in its owned workspace");
    assert.deepEqual(await opened.fs.readFileBuffer(`${opened.fs.root}/workspace/node-proof.bin`), Buffer.from([0, 1, 127, 255]));
    const resume = await session.stop(), snapshot = await snapshotWorkspace(opened.fs);
    await opened.sandbox.destroy();
    const form = bundles.find((skill) => skill.name === "form")!;
    const nextAgent = createNativeAgent({ harness: "pi", mode: "local", env, modelId: "local-test", instructions: "Only the enabled assigned form skill is available now.", skills: [form], tools: {}, stopWhen: stepCountIs(10) });
    const next = await openNativeSandbox({ agent: nextAgent, mode: "local", sandboxId: opened.sandbox.id, hasResumeState: true, workspace: snapshot, env }); assert(next.fs); mountedFs = next.fs;
    const nextSession = await nextAgent.createSession({ sessionId: session.sessionId, sandboxSession: next.sandbox, resumeFrom: resume });
    mountedRoot = next.fs.getAllPaths().find(path => path.endsWith("/form/SKILL.md"))!.replace(/\/form\/SKILL.md$/, "");
    assert.notEqual(next.fs.root, opened.fs.root, "cold restore uses a new real directory");
    try {
      await nextAgent.generate({ session: nextSession, prompt: "Verify revoked report script cannot be read from the restored workspace." });
      assert(!next.fs.getAllPaths().some((path) => path.includes(`${mountedRoot}/report/`)), "SDK manifest removes no-longer-assigned skills from restored snapshots");
      const newSystem = requests[6].messages.filter((message) => message.role === "system").map((message) => String(message.content)).join("\n");
      assert(newSystem.includes(form.description) && !newSystem.includes(report.description), "current provider metadata contains only the enabled assigned skill");
      const revokedRead = requests[7].messages.filter((message) => message.role === "tool").at(-1);
      assert.match(String(revokedRead?.content), /ENOENT|not found|does not exist|outside|unable to resolve path/i, "native read cannot fetch revoked skill files");
    } finally { await nextSession.stop(); await next.sandbox.destroy(); }
    console.log("PASS real builtin bundle mount + progressive native read/bash, actual Python+Node scripts, binary persistence, credential-free process environment and cold revocation.");
  } finally {
    await session.stop().catch(() => {}); await opened.sandbox.destroy(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
