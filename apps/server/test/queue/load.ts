import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, eq, sql } from "drizzle-orm";
import { db, client } from "../../src/db/index.js";
import { organization, tables, columns, automations, automationEvents, rows } from "../../src/db/schema.js";
import { addRow } from "../../src/commands/index.js";

assert.ok(new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_queue_test"));
assert.ok(process.env.QUEUE_PREFIX?.startsWith("agrid-queue-test"));
const count = Number(process.env.LOAD_ROWS ?? 200);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 10000);
const percentile = (a: number[], p: number) => Math.round([...a].sort((x,y) => x-y)[Math.min(a.length-1, Math.floor(a.length*p))] * 10) / 10;
const results: Record<string, unknown>[] = [];
let children: ChildProcess[] = [];
async function start(pool: number) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/queue/main.ts"], {
    env: { ...process.env, DB_POOL_MAX: String(pool), WORKER_CONCURRENCY: "4", AUTOMATION_TENANT_CONCURRENCY: "32" },
    stdio: ["ignore", "pipe", "pipe"],
  }); children.push(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout: worker`)), 15000);
    child.stdout?.on("data", (d) => { if (String(d).includes(`[queue] started automation`)) { clearTimeout(timer); resolve(); } });
    child.stderr?.on("data", (d) => process.stderr.write(d));
    child.once("exit", (code) => { clearTimeout(timer); if (code) reject(new Error(`worker exited ${code}`)); });
  });
}
async function stop() {
  await Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
    child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
  }))); children = [];
}
try {
  for (const replicas of [1,2,4,8]) {
    const org = `load-${randomUUID()}`;
    await db.insert(organization).values({ id: org, name: "isolated load", slug: org });
    const [table] = await db.insert(tables).values({ organizationId: org, name: "load" }).returning();
    const [output] = await db.insert(columns).values({ tableId: table.id, name: "output", type: "text" }).returning();
    // Fan-out: two rules, two actions each. Four durable writes per event.
    await db.insert(automations).values([1,2].map((i) => ({ tableId: table.id, organizationId: org, source: { kind: "table" as const, tableId: table.id }, name: `rule-${i}`,
      trigger: { type: "row_created" }, actions: [
        { type: "update_field", columnId: output.id, value: `rule-${i}-one` },
        { type: "update_field", columnId: output.id, value: `rule-${i}-two` },
      ] })));
    for (let i = 0; i < replicas; i++) await start(2);
    const latencies: number[] = []; const began = performance.now();
    let produced = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (produced++ < count) {
        const at = performance.now(); await addRow({ tableId: table.id, organizationId: org }); latencies.push(performance.now()-at);
      }
    }));
    while (true) {
      const [{ remaining }] = await db.execute(sql`SELECT count(*)::int AS remaining FROM automation_events
        WHERE organization_id=${org} AND finished_at IS NULL`);
      if (!remaining) break;
      if (performance.now()-began > 120000) throw new Error("Load drain timeout");
      await new Promise((r) => setTimeout(r, 100));
    }
    const seconds = (performance.now()-began)/1000;
    const completed = await db.select().from(automationEvents).where(and(eq(automationEvents.organizationId,org), eq(automationEvents.status,"completed")));
    assert.equal(completed.length,count);
    const updated = await db.select({ version: rows.version }).from(rows).where(eq(rows.tableId,table.id));
    assert.ok(updated.every((r) => r.version === 5));
    const lag = completed.map((e) => e.finishedAt!.getTime()-e.createdAt.getTime());
    const [{ waits }] = await db.execute(sql`SELECT count(*)::int AS waits FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'`);
    const result = { workerReplicas: replicas, rows: count, actions: count*4,
      seconds: Math.round(seconds*100)/100, eventsPerSecond: Math.round(count/seconds*10)/10,
      producerP50ms: percentile(latencies,.5), producerP95ms: percentile(latencies,.95), producerP99ms: percentile(latencies,.99),
      eventToFinishP95ms: percentile(lag,.95), dbLockWaitsAtEnd: waits };
    results.push(result); console.log(JSON.stringify(result)); await stop();
  }
  console.log(JSON.stringify({ note: "Local smoke load, direct command latency (not HTTP latency), no LLM or HA failover", results }, null, 2));
} finally { await stop(); await client.end(); }
