import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { superviseApi } from "../../src/dev-supervisor.js";

for (const scenario of ["reload", "shutdown"] as const) test(
  scenario === "reload" ? "repeated watched edits wait for a slow official Pi Run to save, then restart once" : "SIGTERM waits for a slow official Pi Run and its checkpoint before exiting",
  { timeout: 30000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "tabdo-native-reload-"));
  const watched = join(temp, "source"), events = join(temp, "events.jsonl"), script = join(temp, "api.mts");
  await mkdir(watched);
  const source = join(watched, "changing.ts");
  await writeFile(source, "export const version = 0;\n");
  let modelCalls = 0, failure: number | undefined;
  const model = createServer(async (request, response) => {
    for await (const _ of request) { /* consume the native model request */ }
    modelCalls++;
    if (modelCalls === 2) await new Promise((resolve) => setTimeout(resolve, 7000));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant" });
    if (modelCalls === 1) {
      send({ tool_calls: [{ index: 0, id: "once", type: "function", function: { name: "get_fixture", arguments: "{}" } }] });
      send({}, "tool_calls");
    } else { send({ content: "native saved" }); send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const address = model.address(); assert(address && typeof address !== "string");
  const require = createRequire(import.meta.url);
  const url = (file: string) => JSON.stringify(pathToFileURL(file).href);
  const serverRoot = resolve(import.meta.dirname, "../..");
  await writeFile(script, `
import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tool } from ${url(require.resolve("ai"))};
import { z } from ${url(require.resolve("zod"))};
import { createNativeAgent, openNativeSandbox } from ${url(join(serverRoot, "src/harness/runtime.ts"))};
import { registerNativeRun, waitForNativeDrain } from ${url(join(serverRoot, "src/harness/drain.ts"))};
const events = ${JSON.stringify(events)};
const log = (event) => appendFile(events, JSON.stringify({event,pid:process.pid})+"\\n");
const previous = await readFile(events,"utf8").catch(()=>"");
await log("start");
const alive=setInterval(()=>{},1000);
process.on("SIGTERM", async () => { await waitForNativeDrain(); await log("stopped"); clearInterval(alive); if(process.connected)process.disconnect(); });
if (!previous.includes('"saved"')) {
 const release=registerNativeRun();
 let session, sandbox;
 try {
  const agent=createNativeAgent({harness:"pi",mode:"local",modelId:"fixture",env:{PI_API_KEY:"fixture",PI_BASE_URL:"http://127.0.0.1:${address.port}/v1"},instructions:"Use get_fixture once then reply",skills:[],tools:{get_fixture:tool({inputSchema:z.object({}),execute:async()=>{await log("tool");return {ok:true};}})}});
  const opened=await openNativeSandbox({agent,mode:"local",sandboxId:randomUUID(),hasResumeState:false});sandbox=opened.sandbox;
  session=await agent.createSession({sessionId:randomUUID(),sandboxSession:sandbox});
  const result=await agent.generate({session,prompt:"Read fixture"});
  if(result.text!=="native saved")throw Error("native result missing");
  const state=await session.stop();session=undefined;
  if(!state.data.sessionFileName || !opened.fs.getAllPaths().some(path=>path.endsWith(".jsonl")))throw Error("native checkpoint missing");
  await log("saved");
 }catch(error){await log("error:"+error.message);process.exitCode=1;}
 finally {await session?.destroy();await sandbox?.destroy();release();}
}
`);
  const supervisor = superviseApi({ entry: script, cwd: serverRoot, watchPaths: [watched], env: { PATH: process.env.PATH, NODE_ENV: "test" }, onFailure: (code) => { failure = code; } });
  const records = async () => (await readFile(events, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { event: string; pid: number });
  const until = async (predicate: () => Promise<boolean>) => {
    const deadline = Date.now() + 16000;
    while (!await predicate()) { assert(Date.now() < deadline, "native lifecycle timed out"); await new Promise((resolve) => setTimeout(resolve, 50)); }
  };
  try {
    await until(async () => modelCalls === 2);
    for (let version = 1; version <= 4; version++) {
      await writeFile(source, `export const version = ${version};\n`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal((await records()).filter((record) => record.event === "start").length, 1, "live Run was not restarted on edit");
    if (scenario === "shutdown") await supervisor.shutdown();
    else await until(async () => (await records()).filter((record) => record.event === "start").length === 2);
    const observed = await records();
    assert.equal(failure, undefined);
    assert.equal(modelCalls, 2, "reload did not repeat model/tool work");
    assert.equal(observed.filter((record) => record.event === "tool").length, 1);
    assert.equal(observed.filter((record) => record.event === "saved").length, 1);
    assert.equal(observed.filter((record) => record.event === "start").length, scenario === "reload" ? 2 : 1);
    assert(observed.findIndex((record) => record.event === "saved") < observed.findIndex((record) => record.event === "stopped"), "checkpoint preceded process shutdown");
    if (scenario === "reload") assert(observed.findIndex((record) => record.event === "saved") < observed.findIndex((record, index) => index > 0 && record.event === "start"), "checkpoint preceded new process");
    assert.equal(observed.filter((record) => record.event.startsWith("error:")).length, 0);
  } finally {
    await supervisor.shutdown();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});
