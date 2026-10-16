import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { withNativeProcessFixture } from "../helpers/native-process-fixture.js";

for (const scenario of ["reload", "shutdown"] as const) test(
  scenario === "reload" ? "repeated watched edits wait for a slow official Pi Run to save, then restart once" : "SIGTERM waits for a slow official Pi Run and its checkpoint before exiting",
  { timeout: 30000 }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "tabdo-native-reload-"));
  const watched = join(temp, "source"), events = join(temp, "events.jsonl"), script = join(temp, "api.mts");
  const source = join(watched, "changing.ts");
  try {
    await mkdir(watched);
    await writeFile(source, "export const version = 0;\n");
    await withNativeProcessFixture(t, async fixture => {
      let modelCalls = 0;
      const baseUrl = await fixture.listen(async (request, response) => {
        for await (const _ of request) { /* consume the native model request */ }
        modelCalls++;
        fixture.phase(`model request ${modelCalls}`);
        if (modelCalls === 2) await fixture.delay(7000);
        response.writeHead(200, { "content-type": "text/event-stream" });
        const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        send({ role: "assistant" });
        if (modelCalls === 1) {
          send({ tool_calls: [{ index: 0, id: "once", type: "function", function: { name: "get_fixture", arguments: "{}" } }] });
          send({}, "tool_calls");
        } else { send({ content: "native saved" }); send({}, "stop"); }
        response.end("data: [DONE]\n\n");
      });
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
const log = (event) => appendFile(events, JSON.stringify({event,pid:process.pid,at:Date.now()})+"\\n");
const previous = await readFile(events,"utf8").catch(()=>"");
await log("start");
const alive=setInterval(()=>{},1000);
process.on("SIGTERM", async () => { await log("drain"); await waitForNativeDrain(); await log("stopped"); clearInterval(alive); if(process.connected)process.disconnect(); });
if (!previous.includes('"saved"')) {
 const release=registerNativeRun();
 let session, sandbox;
 try {
  const agent=createNativeAgent({harness:"pi",mode:"local",modelId:"fixture",env:{PI_API_KEY:"fixture",PI_BASE_URL:${JSON.stringify(baseUrl)}},instructions:"Use get_fixture once then reply",skills:[],tools:{get_fixture:tool({inputSchema:z.object({}),execute:async()=>{await log("tool");return {ok:true};}})}});
  const opened=await openNativeSandbox({agent,mode:"local",sandboxId:randomUUID(),hasResumeState:false});sandbox=opened.sandbox;
  session=await agent.createSession({sessionId:randomUUID(),sandboxSession:sandbox});
  const result=await agent.generate({session,prompt:"Read fixture"});
  if(result.text!=="native saved")throw Error("native result missing");
  await log("checkpoint");
  const state=await session.stop();session=undefined;
  if(!state.data.sessionFileName || !opened.fs.getAllPaths().some(path=>path.endsWith(".jsonl")))throw Error("native checkpoint missing");
  await log("saved");
 }catch(error){await log("error:"+error.message);process.exitCode=1;}
 finally {await session?.destroy();await sandbox?.destroy();release();}
}
`);
      // The test owns this supervisor process group, including its API children.
      const supervisor = fixture.spawn("lifecycle supervisor", ["--import", "tsx", "--conditions=development", join(serverRoot, "test/helpers/native-supervisor-worker.ts"), script, serverRoot, watched], { cwd: serverRoot, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
      let reported = 0;
      const records = async () => {
        const observed = (await readFile(events, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { event: string; pid: number; at: number });
        for (const record of observed.slice(reported)) fixture.phase(`API ${record.event} pid=${record.pid} at=${record.at}`);
        reported = observed.length;
        return observed;
      };
      await fixture.until("model request 2", async () => { await records(); return modelCalls === 2; }, supervisor);
      for (let version = 1; version <= 4; version++) {
        await writeFile(source, `export const version = ${version};\n`);
        await fixture.delay(250);
      }
      assert.equal((await records()).filter((record) => record.event === "start").length, 1, "live Run was not restarted on edit");
      if (scenario === "shutdown") {
        fixture.phase("shutdown requested");
        supervisor.child.send("shutdown");
        await fixture.wait(supervisor.exited);
      } else await fixture.until("second API start", async () => (await records()).filter((record) => record.event === "start").length === 2, supervisor);
      const observed = await records();
      assert.equal(modelCalls, 2, "reload did not repeat model/tool work");
      assert.equal(observed.filter((record) => record.event === "tool").length, 1);
      assert.equal(observed.filter((record) => record.event === "saved").length, 1);
      assert.equal(observed.filter((record) => record.event === "start").length, scenario === "reload" ? 2 : 1);
      assert(observed.findIndex((record) => record.event === "saved") < observed.findIndex((record) => record.event === "stopped"), "checkpoint preceded process shutdown");
      if (scenario === "reload") assert(observed.findIndex((record) => record.event === "saved") < observed.findIndex((record, index) => index > 0 && record.event === "start"), "checkpoint preceded new process");
      assert.equal(observed.filter((record) => record.event.startsWith("error:")).length, 0);
      if (scenario === "reload") {
        fixture.phase("shutdown requested");
        supervisor.child.send("shutdown");
        await fixture.wait(supervisor.exited);
      }
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
});
