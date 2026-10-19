import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "../runtime.js";
import { and, eq } from "drizzle-orm";
import { asSchema } from "ai";
import { DISABLED_TOOLS_SCHEMA, MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from "@tabdo/shared";
import { db, client } from "../../src/db/index.js";
import { organization, user, member, agentProfile, workspaces } from "../../src/db/schema.js";
import { admitAgentMemory, listAgentMemory, readAgentMemory, writeAgentMemory, forgetAgentMemory, renderMemoryIndex, assertMemoryIndexBudget, serializeMemoryDocument } from "../../src/business/agent/memory.js";
import type { AgentMemoryScope } from "../../src/business/agent/memory.js";
import type { Actor } from "../../src/auth/actor.js";
import { createMemoryTools } from "../../src/business/agent/tools/memory.js";
import { getAgentToolCatalog } from "../../src/harness/tool-catalog.js";
import { prepareNativeChatAgent } from "../../src/harness/preparation.js";
import { resolveChatContext } from "../../src/chat/context.js";

if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const deps = { database: db, uuid: randomUUID };
const org = randomUUID(), foreignOrg = randomUUID();
const owner = randomUUID(), other = randomUUID(), bot = randomUUID(), botB = randomUUID(), foreignBot = randomUUID();
const people = [owner, other, bot, botB, foreignBot];
const profile = randomUUID(), profileB = randomUUID(), foreignProfile = randomUUID();
let actor: Actor, scope: AgentMemoryScope, workspaceB: string, foreignWorkspace: string;
const value = (topic: string) => ({ topic, expectedRevision: null, name: "报价偏好", description: "先列总价", type: "feedback" as const, body: "先列总价，再列明细。\n\n```yaml\ntype: project\n---\n```" });

before(async () => {
  await db.insert(organization).values([org, foreignOrg].map(id => ({ id, name: "Memory fixture", slug: id })));
  await db.insert(user).values(people.map(id => ({ id, name: id, email: `${id}@memory.test`, kind: [owner, other].includes(id) ? "human" as const : "agent" as const })));
  const memberships = people.map(id => ({ id: randomUUID(), userId: id, organizationId: id === foreignBot ? foreignOrg : org, role: "owner" }));
  memberships.push({ id: randomUUID(), userId: owner, organizationId: foreignOrg, role: "owner" });
  await db.insert(member).values(memberships);
  await db.insert(agentProfile).values([
    { id: profile, userId: bot, memberId: memberships[2].id, organizationId: org, displayName: "A", persona: { skillNames: [] } },
    { id: profileB, userId: botB, memberId: memberships[3].id, organizationId: org, displayName: "B", persona: { skillNames: [] } },
    { id: foreignProfile, userId: foreignBot, memberId: memberships[4].id, organizationId: foreignOrg, displayName: "Foreign", persona: { skillNames: [] } },
  ]);
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  const [foreign] = await db.select().from(workspaces).where(eq(workspaces.organizationId, foreignOrg));
  const [second] = await db.insert(workspaces).values({ organizationId: org, name: "Other workspace" }).returning();
  workspaceB = second.id; foreignWorkspace = foreign.id;
  actor = { kind: "human", userId: owner, memberId: memberships[0].id, organizationId: org, workspaceId: workspace.id, role: "owner", name: "Fixture", email: `${owner}@memory.test` };
  scope = await admitAgentMemory(deps, actor, profile);
});
after(async () => {
  for (const id of [org, foreignOrg]) await db.delete(organization).where(eq(organization.id, id));
  for (const id of people) await db.delete(user).where(eq(user.id, id));
  await client.end();
});

test("default preparation adds Pi memory guidance once and excludes other harnesses", async () => {
  const env = { PI_API_KEY: "fixture", PI_BASE_URL: "http://127.0.0.1:1/v1", PI_MODEL: "fixture", PI_CONTEXT_WINDOW: "65536", PI_MAX_OUTPUT_TOKENS: "512" };
  const context = await resolveChatContext({ page: "ai" }, actor);
  const prepare = () => prepareNativeChatAgent({ actor, agentId: bot, context, env });
  for (let i = 0; i < 2; i++) {
    const result = await prepare();
    assert.equal(result.system.split("<tabdo_auto_memory>").length, 2);
    assert.match(result.system, /proactively save/);
    for (const name of ["memory_read", "memory_write", "memory_list", "memory_forget"]) assert(result.tools[name]);
  }
  await db.update(agentProfile).set({ persona: { skillNames: [], disabledTools: ["update_cell"] } }).where(eq(agentProfile.id, profile));
  const alwaysOn = await prepare();
  assert.match(alwaysOn.system, /<tabdo_auto_memory>/);
  assert.match(alwaysOn.system, /# MEMORY.md/);
  for (const id of ["memory_list", "memory_read", "memory_write", "memory_forget"]) {
    assert(alwaysOn.tools[id]);
    assert(!DISABLED_TOOLS_SCHEMA.safeParse([id]).success, "memory cannot be disabled through user settings");
    for (const harness of ["pi", "claude", "codex"] as const) assert(!getAgentToolCatalog(harness).tools.some(tool => tool.id === id), "memory is not a selectable capability");
  }
  assert.deepEqual(alwaysOn.disabledTools, ["update_cell"], "ordinary tool settings are unchanged");
  for (const harness of ["claude", "codex"] as const) {
    await db.update(agentProfile).set({ persona: { skillNames: [], defaultHarness: harness, runtime: "sandbox", sandboxProvider: "vercel" } }).where(eq(agentProfile.id, profile));
    const prepared = await prepareNativeChatAgent({ actor, agentId: bot, context, env: { ...env, VERCEL_TOKEN: "fixture", VERCEL_TEAM_ID: "fixture", VERCEL_PROJECT_ID: "fixture", ANTHROPIC_API_KEY: "fixture", OPENAI_API_KEY: "fixture" } });
    assert(!prepared.tools.memory_write); assert(!prepared.system.includes("<tabdo_auto_memory>"));
  }
  await db.update(agentProfile).set({ persona: { skillNames: [] } }).where(eq(agentProfile.id, profile));
});

test("durable documents preserve Markdown/metadata, deduplicate and never resurrect stale deletes", async () => {
  const input = value("quotation.md");
  const first = await writeAgentMemory(deps, scope, input);
  assert.equal((await writeAgentMemory(deps, scope, input)).revision, first.revision);
  const read = await readAgentMemory(deps, scope, { topic: input.topic });
  assert.equal(read.body, input.body);
  assert.match(read.markdown, /\ntype: feedback\n---\n/);
  assert.equal(read.markdown, serializeMemoryDocument(read));
  const updated = await writeAgentMemory(deps, scope, { topic: input.topic, expectedRevision: first.revision, body: "新偏好" });
  assert.notEqual(updated.revision, first.revision);
  const current = await readAgentMemory(deps, scope, { topic: input.topic });
  assert.equal(current.name, input.name); assert.equal(current.description, input.description); assert.equal(current.type, input.type);
  await assert.rejects(writeAgentMemory(deps, scope, { ...input, expectedRevision: first.revision }), /记忆已变化/);
  const forgotten = await forgetAgentMemory(deps, scope, { topic: input.topic, expectedRevision: updated.revision });
  assert(!forgotten.index.includes(input.topic));
  await assert.rejects(writeAgentMemory(deps, scope, { ...input, expectedRevision: updated.revision }), /记忆已变化/);
  await assert.rejects(readAgentMemory(deps, scope, { topic: input.topic }), /不存在/);
  const recreated = await writeAgentMemory(deps, scope, input);
  assert.notEqual(recreated.revision, updated.revision);
  await assert.rejects(forgetAgentMemory(deps, scope, { topic: input.topic, expectedRevision: updated.revision }), /记忆已变化/);
  await forgetAgentMemory(deps, scope, { topic: input.topic, expectedRevision: recreated.revision });
});

test("same-scope concurrent writes serialize; stale updates conflict and caller rollback is atomic", async () => {
  await Promise.all(["one.md", "two.md"].map(topic => writeAgentMemory(deps, scope, value(topic))));
  const listing = await listAgentMemory(deps, scope);
  assert(listing.index.includes("one.md") && listing.index.includes("two.md"));
  const read = await readAgentMemory(deps, scope, { topic: "one.md" });
  const results = await Promise.allSettled(["甲", "乙"].map(body => writeAgentMemory(deps, scope, { topic: "one.md", expectedRevision: read.revision, body })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  await assert.rejects(db.transaction(async tx => {
    await writeAgentMemory(deps, scope, value("rollback.md"), tx);
    throw new Error("rollback fixture");
  }), /rollback fixture/);
  await assert.rejects(readAgentMemory(deps, scope, { topic: "rollback.md" }), /不存在/);
  for (const topic of ["one.md", "two.md"]) {
    const { revision } = await readAgentMemory(deps, scope, { topic }); await forgetAgentMemory(deps, scope, { topic, expectedRevision: revision });
  }
});

test("agent, user, workspace and organization isolation; model arguments cannot select a scope/path", async () => {
  const saved = await writeAgentMemory(deps, scope, value("private.md"));
  const others = [
    { ...scope, agentProfileId: profileB }, { ...scope, userId: other }, { ...scope, workspaceId: workspaceB },
    { ...scope, organizationId: foreignOrg, workspaceId: foreignWorkspace, agentProfileId: foreignProfile },
  ];
  for (const foreign of others) {
    assert.equal((await listAgentMemory(deps, foreign)).topics.length, 0);
    await assert.rejects(readAgentMemory(deps, foreign, { topic: "private.md" }), /不存在/);
    await assert.rejects(forgetAgentMemory(deps, foreign, { topic: "private.md", expectedRevision: saved.revision }), /记忆已变化/);
  }
  await assert.rejects(listAgentMemory(deps, { ...scope, workspaceId: foreignWorkspace }), /工作区不可访问/);
  await assert.rejects(listAgentMemory(deps, { ...scope, agentProfileId: foreignProfile }), /智能体不存在/);
  const tools = createMemoryTools(() => deps, scope);
  for (const [name, definition] of Object.entries(tools)) {
    const schema = asSchema(definition.inputSchema); assert(schema.validate);
    const valid = name === "memory_list" ? {} : name === "memory_write" ? value("ok.md") : name === "memory_forget" ? { topic: "ok.md", expectedRevision: saved.revision } : { topic: "ok.md" };
    for (const malicious of [{ userId: other }, { organizationId: foreignOrg }, { workspaceId: workspaceB }, { agentProfileId: profileB }, { root: "/tmp" }]) assert(!(await schema.validate({ ...valid, ...malicious })).success);
    if (name !== "memory_list") for (const topic of ["../private.md", "/tmp/private.md", "MEMORY.md", "memory.md", "a/b.md", "a\\b.md", "x.md\n"]) assert(!(await schema.validate({ ...valid, topic })).success);
  }
  await forgetAgentMemory(deps, scope, { topic: "private.md", expectedRevision: saved.revision });
});

test("memory is intrinsic even if raw persona contains old exclusions; bound tools still recheck membership", async () => {
  const bound = createMemoryTools(() => deps, scope);
  await db.update(agentProfile).set({ persona: { disabledTools: ["memory_list", "memory_read", "memory_write", "memory_forget"] } }).where(eq(agentProfile.id, profile));
  const execution = { toolCallId: "always-on", messages: [], context: {} };
  const saved = await bound.memory_write.execute!(value("always-on.md"), execution);
  assert((await bound.memory_list.execute!({}, execution)).index.includes("always-on.md"));
  assert.equal((await bound.memory_read.execute!({ topic: "always-on.md" }, execution)).body, value("always-on.md").body);
  await bound.memory_forget.execute!({ topic: "always-on.md", expectedRevision: saved.revision }, execution);
  await db.update(agentProfile).set({ persona: { skillNames: [] } }).where(eq(agentProfile.id, profile));
  const alternate = { ...scope, userId: other };
  const revokedBound = createMemoryTools(() => deps, alternate);
  const [membership] = await db.delete(member).where(and(eq(member.userId, other), eq(member.organizationId, org))).returning();
  await assert.rejects(revokedBound.memory_list.execute!({}, execution), /成员资格已撤销/);
  await db.insert(member).values(membership);
  const [agentMembership] = await db.delete(member).where(and(eq(member.userId, botB), eq(member.organizationId, org))).returning();
  // Deleting an agent membership cascades its profile; no stale bound access survives.
  await assert.rejects(listAgentMemory(deps, { ...scope, agentProfileId: profileB }), /智能体不存在/);
  await db.insert(member).values(agentMembership);
});

test("index has hard line/UTF-8 byte limits; rejected additions leave no topic", async () => {
  assert.doesNotThrow(() => assertMemoryIndexBudget("x\n".repeat(MEMORY_INDEX_MAX_LINES - 1)));
  assert.throws(() => assertMemoryIndexBudget("x\n".repeat(MEMORY_INDEX_MAX_LINES)), /上限/);
  assert.doesNotThrow(() => assertMemoryIndexBudget("x".repeat(MEMORY_INDEX_MAX_BYTES)));
  assert.throws(() => assertMemoryIndexBudget("中".repeat(Math.ceil(MEMORY_INDEX_MAX_BYTES / 3))), /上限/);
  const budgetScope = { ...scope, workspaceId: workspaceB };
  const metadata = { name: "短", description: "短", type: "user" as const };
  for (let i = 0; i < 199; i++) await writeAgentMemory(deps, budgetScope, { topic: `t${i}.md`, expectedRevision: null, body: "正文不应出现在索引", ...metadata });
  const listing = await listAgentMemory(deps, budgetScope);
  assert.equal(listing.index.split("\n").length, 200); assert(!listing.index.includes("正文不应出现在索引"));
  await assert.rejects(writeAgentMemory(deps, budgetScope, { topic: "overflow.md", expectedRevision: null, body: "x", ...metadata }), /上限/);
  await assert.rejects(readAgentMemory(deps, budgetScope, { topic: "overflow.md" }), /不存在/);
  // Byte overflow on creation rolls back both the topic and its generated index.
  const largeScope = { ...scope, userId: other, workspaceId: workspaceB };
  let rejected = false;
  for (let i = 0; i < 100; i++) {
    try { await writeAgentMemory(deps, largeScope, { topic: `b${i}.md`, expectedRevision: null, body: "x", name: "中".repeat(160), description: "文".repeat(160), type: "project" }); }
    catch (error) { assert.match(String(error), /上限/);rejected = true;await assert.rejects(readAgentMemory(deps, largeScope, { topic: `b${i}.md` }), /不存在/);break; }
  }
  assert(rejected);
  assert((await listAgentMemory(deps, largeScope)).index.length > 0);
  assert.equal(renderMemoryIndex([]), "# MEMORY.md");
});

test("storage failure is propagated instead of returning an empty successful memory store", async () => {
  const database = { transaction: async () => { throw new Error("memory storage unavailable"); } } as unknown as typeof db;
  await assert.rejects(listAgentMemory({ database }, scope), /memory storage unavailable/);
});
