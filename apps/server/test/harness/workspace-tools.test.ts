import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { asSchema } from "ai";
import { createNativeAgent, openNativeSandbox } from "../../src/harness/runtime.js";
import { nativeHostTools } from "../../src/harness/tools.js";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, user, member, agentProfile } = await import("../../src/db/schema.js");
const cmds = await import("../../src/commands/index.js");
const { createTableTools } = await import("../../src/ai/tools.js");

test("native harness discovers real member identities, assigns person and keeps queries scoped", { timeout: 20000 }, async () => {
  const orgId = randomUUID(), foreignOrg = randomUUID(), actorId = randomUUID(), ownerId = randomUUID(), outsiderId = randomUUID();
  let opened: Awaited<ReturnType<typeof openNativeSandbox>> | undefined;
  let session: Awaited<ReturnType<ReturnType<typeof createNativeAgent>["createSession"]>> | undefined;
  let rowId = "", columnId = "", calls = 0;
  const requests: { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[] = [];
  const provider = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw); requests.push(input); calls++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: "member-fixture", object: "chat.completion.chunk", created: 1, model: "local-members", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: "assistant" });
    if (calls === 1) {
      send({ tool_calls: [{ index: 0, id: "get-members", type: "function", function: { name: "list_members", arguments: JSON.stringify({ kind: "human", search: "张三" }) } }] });
      send({}, "tool_calls");
    } else if (calls === 2) {
      // Derive identity from the actual tool result, never inject a known UUID into the model request.
      const output = input.messages.find((message: { role: string }) => message.role === "tool");
      const text = typeof output?.content === "string" ? output.content : JSON.stringify(output?.content);
      const discovered = /"userId"\s*:\s*"([^"]+)"/.exec(text)?.[1];
      send({ tool_calls: [{ index: 0, id: "assign-member", type: "function", function: { name: "update_cell", arguments: JSON.stringify({ rowId, columnId, value: discovered }) } }] });
      send({}, "tool_calls");
    } else { send({ content: "已分配给张三。" }); send({}, "stop"); }
    response.end("data: [DONE]\n\n");
  });
  try {
    await db.insert(organization).values([orgId, foreignOrg].map(id => ({ id, name: "Workspace fixture", slug: id })));
    await db.insert(user).values([{ id: actorId, name: "表格大师", email: actorId + "@local.test", kind: "agent" }, { id: ownerId, name: "张三", email: ownerId + "@local.test", kind: "human" }, { id: outsiderId, name: "张三", email: outsiderId + "@local.test", kind: "human" }]);
    const actorMember = randomUUID();
    await db.insert(member).values([{ id: actorMember, organizationId: orgId, userId: actorId, role: "member" }, { id: randomUUID(), organizationId: orgId, userId: ownerId, role: "owner" }, { id: randomUUID(), organizationId: foreignOrg, userId: outsiderId, role: "owner" }]);
    await db.insert(agentProfile).values({ userId: actorId, memberId: actorMember, organizationId: orgId, displayName: "表格大师", persona: { systemPrompt: "处理团队任务" }, apiKeyHash: "fixture-secret-must-not-leak" });
    const scope = { organizationId: orgId, actorId };
    const workspace = await cmds.getWorkspace(scope); assert.equal(workspace.workspace.id, orgId); assert.equal(workspace.actor?.userId, actorId);
    const people = await cmds.listMembers({ ...scope, search: "张三", kind: "human" }); assert.equal(people.total, 1); assert.equal(people.members[0].userId, ownerId); assert.notEqual(people.members[0].id, ownerId);
    const agents = await cmds.listMembers({ ...scope, kind: "agent" }); assert.equal(agents.members[0].userId, actorId); assert.equal(agents.members[0].agent?.persona.systemPrompt, "处理团队任务"); assert(!JSON.stringify(agents).includes("fixture-secret"));
    const first = await cmds.listMembers({ ...scope, limit: 1 }); const second = await cmds.listMembers({ ...scope, offset: 1, limit: 1 }); assert(first.hasMore); assert(!second.hasMore); assert.notEqual(first.members[0].userId, second.members[0].userId);
    await assert.rejects(cmds.listMembers({ organizationId: foreignOrg, actorId }), /不属于/);
    const table = await cmds.createTable({ organizationId: orgId, name: "Tasks" });
    columnId = (await cmds.addColumn({ ...scope, tableId: table.id, name: "负责人", type: "person" })).id;
    rowId = (await cmds.addRow({ ...scope, tableId: table.id })).id;
    const definitions = createTableTools(table.id, orgId, actorId);
    const schema = asSchema(definitions.list_members.inputSchema);
    assert(schema.validate); assert(!(await schema.validate({ organizationId: foreignOrg })).success);
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address(); assert(address && typeof address !== "string");
    const env = { PI_API_KEY: "local-fixture-only", PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` };
    const hosted = nativeHostTools(definitions, work => work());
    const agent = createNativeAgent({ harness: "pi", mode: "local", modelId: "local-members", env, instructions: "查询当前成员的真实userId后分配负责人。", skills: [], tools: hosted.tools });
    opened = await openNativeSandbox({ agent, mode: "local", sandboxId: randomUUID(), hasResumeState: false, env });
    session = await agent.createSession({ sessionId: randomUUID(), sandboxSession: opened.sandbox });
    const result = await agent.generate({ session, prompt: "把任务分配给张三" });
    assert.equal(result.text, "已分配给张三。"); assert.equal(calls, 3); assert.equal(hosted.failures.size, 0);
    assert.equal((await cmds.getRow({ ...scope, rowId })).cells[columnId], ownerId);
    assert(!JSON.stringify(requests).includes(outsiderId));
    for (const name of ["get_workspace", "list_members"]) assert(requests[0].tools?.some(tool => tool.function.name === name));
  } finally {
    await session?.stop(); await opened?.sandbox.stop(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
    for (const id of [orgId, foreignOrg]) await db.delete(organization).where(eq(organization.id, id));
    for (const id of [actorId, ownerId, outsiderId]) await db.delete(user).where(eq(user.id, id));
    await client.end();
  }
});
