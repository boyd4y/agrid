import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { BATCH_TOOLS } from "@tabdo/shared";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { nativeHostTools } from "../../src/harness/tools.js";
import { getAgentToolCatalog, validateDisabledTools } from "../../src/harness/tool-catalog.js";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, rows, automations } = await import("../../src/db/schema.js");
const { eq } = await import("drizzle-orm");
const { createTable, getTable } = await import("../../src/commands/index.js");
const { createTableTools } = await import("../../src/ai/tools.js");

test("native batch mock writes 100 records once, advertises canonical batch tools and creates no automation", { timeout: 20000 }, async () => {
  const orgId = randomUUID();
  let opened: Awaited<ReturnType<typeof openNativeSandbox>> | undefined;
  let session: Awaited<ReturnType<ReturnType<typeof createNativeAgent>["createSession"]>> | undefined;
  const requests: { tools?: { function: { name: string; parameters: unknown } }[]; messages: {role: string; content: unknown}[] }[] = [];
  let payload: unknown;
  const provider = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({id:"batch-fixture",object:"chat.completion.chunk",created:1,model:"local-batch",choices:[{index:0,delta,finish_reason}]})}\n\n`);
    send({role:"assistant"});
    if (requests.length === 1) {
      send({tool_calls:[{index:0,id:"batch-100",type:"function",function:{name:"batch_add_rows",arguments:JSON.stringify(payload)}}]});
      send({},"tool_calls");
    } else { send({content:"已新增100条示例记录。"}); send({},"stop"); }
    response.end("data: [DONE]\n\n");
  });
  try {
    await db.insert(organization).values({id:orgId,name:"Batch native fixture",slug:orgId});
    const table = await createTable({organizationId:orgId,name:"Mock target"});
    const before = await getTable({organizationId:orgId,tableId:table.id});
    const title = before.columns[0].id;
    payload = {rows:Array.from({length:100},(_,index)=>({cells:{[title]:`Fixture ${index+1}`}}))};
    for (const harness of ["pi","codex","claude"] as const) {
      const catalog = getAgentToolCatalog(harness);
      for (const name of Object.keys(BATCH_TOOLS)) assert(catalog.tools.some(item => item.id === name));
      assert.deepEqual(validateDisabledTools(harness,["batch_add_rows"]),["batch_add_rows"]);
    }
    await new Promise<void>(resolve => provider.listen(0,"127.0.0.1",resolve));
    const address = provider.address(); assert(address && typeof address !== "string");
    const env = {PI_API_KEY:"local-fixture-only",PI_BASE_URL:`http://127.0.0.1:${address.port}/v1`};
    const tools = createTableTools(table.id,orgId);
    const hosted = nativeHostTools(tools, operation => operation());
    const agent = createNativeAgent({harness:"pi",mode:"local",modelId:"local-batch",env,instructions:"Write mock records with batch_add_rows, then summarize the result.",skills:[],tools:hosted.tools});
    opened = await openNativeSandbox({agent,mode:"local",sandboxId:randomUUID(),hasResumeState:false,env});
    session = await agent.createSession({sessionId:randomUUID(),sandboxSession:opened.sandbox});
    const result = await agent.generate({session,prompt:"当前表随机新增100条mock记录"});
    assert.equal(result.text,"已新增100条示例记录。");
    assert.equal(requests.length,2);
    const names = requests[0].tools!.map(tool => tool.function.name);
    for (const name of Object.keys(BATCH_TOOLS)) assert(names.includes(name));
    const nativeResult = requests[1].messages.find(message => message.role === "tool");
    assert(nativeResult);
    const output = typeof nativeResult.content === "string" ? nativeResult.content : JSON.stringify(nativeResult.content);
    assert.match(output, /"count"\s*:\s*100/, output);
    assert.equal((await db.select().from(rows).where(eq(rows.tableId,table.id))).length,100);
    assert.equal((await db.select().from(automations).where(eq(automations.tableId,table.id))).length,0);
    assert.equal((await getTable({tableId:table.id,organizationId:orgId})).rowCount,100);
  } finally {
    if (session) await session.stop();
    if (opened) await opened.sandbox.stop();
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(()=>resolve()));
    await db.delete(organization).where(eq(organization.id,orgId));
    await client.end();
  }
});
