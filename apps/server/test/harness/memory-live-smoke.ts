/** Opt-in, bounded paid smoke using only a newly created fixture scope. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, client } from "../../src/db/index.js";
import { organization, user, member, agentProfile, workspaces } from "../../src/db/schema.js";
import { admitAgentMemory, listAgentMemory } from "../../src/business/agent/memory.js";
import type { Actor } from "../../src/auth/actor.js";

if (process.env.RUN_MEMORY_LIVE_SMOKE !== "1" || !new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_agent_test")) throw new Error("Opt in with RUN_MEMORY_LIVE_SMOKE=1 and a dedicated *_agent_test database");
if (!process.env.PI_API_KEY || !process.env.PI_BASE_URL || !process.env.PI_MODEL) throw new Error("Configure PI_API_KEY, PI_BASE_URL, PI_MODEL");
const org = randomUUID(), owner = randomUUID(), bot = randomUUID(), profile = randomUUID();
try {
  await db.insert(organization).values({ id: org, name: "Owned memory live smoke", slug: org });
  await db.insert(user).values([{ id: owner, name: "Smoke user", email: `${owner}@memory.test` }, { id: bot, name: "Smoke agent", email: `${bot}@memory.test`, kind: "agent" }]);
  await db.insert(member).values([{ id: owner, userId: owner, organizationId: org, role: "owner" }, { id: bot, userId: bot, organizationId: org, role: "member" }]);
  await db.insert(agentProfile).values({ id: profile, organizationId: org, userId: bot, memberId: bot, displayName: "Smoke", persona: { skillNames: [] } });
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.organizationId, org));
  const actor: Actor = { kind: "human", organizationId: org, userId: owner, memberId: owner, workspaceId: workspace.id, role: "owner", name: "Smoke user", email: `${owner}@memory.test` };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (key.startsWith("PI_") || key === "HARNESS_LOCAL_ENABLED") && value !== undefined)) as Record<string, string>;
  env.PI_MAX_OUTPUT_TOKENS = "768";
  const run = async (prompt: string) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/helpers/memory-process-worker.ts", JSON.stringify({ actor, agentId: bot, prompt, env: {} })], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject);child.on("exit", resolve); });
      // SDK errors may contain provider details. Print only the exit and stage; never credentials.
      assert.equal(code, 0, `Live worker failed (stderr present: ${Boolean(stderr)})`);
      return JSON.parse(stdout) as { text: string; threadId: string; failures: string[]; executedTools: string[] };
    } finally { clearTimeout(timer); }
  };
  const first = await run("我日常需要给客户报价；我的固定偏好是先列总价，再列明细。现在只确认这个习惯，先不用做报价。");
  assert.deepEqual(first.failures, []);assert(first.executedTools.includes("memory_write"), "Capture must commit through memory_write");
  const scope = await admitAgentMemory({ database: db }, actor, profile);
  const saved = await listAgentMemory({ database: db }, scope);
  assert(saved.topics.length > 0, "Real model did not voluntarily capture the durable preference");
  const second = await run("我现在要给客户报价，我习惯怎样排列总价和明细？请先用记忆读取工具核对再回答。");
  assert.notEqual(second.threadId, first.threadId);assert.deepEqual(second.failures, []);
  assert(second.executedTools.includes("memory_read"), "Recall must read a topic through memory_read");
  assert.match(second.text, /总价/);assert.match(second.text, /明细/);
  console.log(JSON.stringify({ scenario: "real-configured-model", model: process.env.PI_MODEL, voluntaryCapture: true, topicCount: saved.topics.length, freshThreadRecall: true, captureTools: first.executedTools, recallTools: second.executedTools, answer: second.text }));
} finally {
  await db.delete(organization).where(eq(organization.id, org));
  for (const id of [owner, bot]) await db.delete(user).where(eq(user.id, id));
  await client.end();
  console.log("Owned live-smoke organization/users/threads/memories removed; DB connection closed.");
}
