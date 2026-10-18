import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate.js";
const endpoint = new URL(process.env.DATABASE_URL!);
assert(endpoint.pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL_UNPOOLED, endpoint.toString());
assert.equal(endpoint.pathname, `/${process.env.HERDR_TEAM_TEST_DATABASE}`);
const namespace = process.env.HERDR_TEAM_NAMESPACE!; assert(/^[a-z0-9_]+$/.test(namespace));
const admin = postgres(endpoint.toString(), { max: 1, onnotice: () => {} });
const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "calendar-members-"));
const old = join(temporary, "through38"); cpSync(source, old, { recursive: true });
const journal = JSON.parse(readFileSync(join(old, "meta/_journal.json"), "utf8"));
writeFileSync(join(old, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx <= 38) }));
const clients: { name: string; sql: ReturnType<typeof postgres> }[] = [];
async function create(label: string) {
  const name = `${namespace}_${process.pid}_${label}_agent_test`; await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(endpoint); url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} }); clients.push({ name, sql }); return sql;
}
async function catalog(sql: ReturnType<typeof postgres>) {
  return {
    columns: await sql`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    constraints: await sql`SELECT c.relname,t.conname,t.contype,pg_get_constraintdef(t.oid) FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.conname`,
    indexes: await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
  };
}
try {
  const fresh = await create("fresh"); await runMigrations(fresh, source);
  const upgrade = await create("upgrade"); await runMigrations(upgrade, old);
  const org = randomUUID(), calendar = randomUUID(), person = randomUUID(), booking = randomUUID(), uid = randomUUID(), key = randomUUID();
  await upgrade`INSERT INTO organization(id,name,slug) VALUES (${org},'Retained',${org})`;
  const [workspace] = await upgrade`SELECT id FROM workspaces WHERE organization_id=${org}`;
  await upgrade`INSERT INTO "user"(id,name,email) VALUES (${uid},'Retained',${uid + '@local.test'})`;
  await upgrade`INSERT INTO member(id,user_id,organization_id,role) VALUES (${randomUUID()},${uid},${org},'owner')`;
  await upgrade`INSERT INTO calendars(id,workspace_id,organization_id,name,time_zone) VALUES (${calendar},${workspace.id},${org},'Retained','UTC')`;
  await upgrade`INSERT INTO calendar_people(id,workspace_id,user_id,name,time_zone,windows) VALUES (${person},${workspace.id},${uid},'Legacy','UTC','[{"day":1,"start":"09:00","end":"17:00"}]'::jsonb)`;
  await upgrade`INSERT INTO bookings(id,workspace_id,calendar_id,person_id,title,"start","end",time_zone,version,revision) VALUES (${booking},${workspace.id},${calendar},${person},'Retained','2030-01-07T09:00Z','2030-01-07T09:30Z','UTC',3,4)`;
  await upgrade`INSERT INTO api_keys(id,organization_id,name,key_hash,prefix) VALUES (${key},${org},'Retained','retained-hash','retained')`;
  await upgrade`INSERT INTO api_key_calendars(key_id,calendar_id,can_read,can_create,can_subscribe) VALUES (${key},${calendar},true,true,true)`;
  await upgrade`INSERT INTO calendar_receipts(workspace_id,principal_id,command,key,request_hash,result) VALUES (${workspace.id},${uid},'createBooking','retained','retained','{"version":3}'::jsonb)`;
  const names = await upgrade`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  async function retained() {
    const values: Record<string, unknown> = {};
    for (const { tablename } of names) {
      const value = tablename === "bookings" ? "to_jsonb(t)-'scheduling_mode'" : "to_jsonb(t)";
      values[tablename] = await upgrade.unsafe(`SELECT ${value} AS value FROM "${tablename}" t ORDER BY ${value}::text`);
    }
    return values;
  }
  const before = await retained(), ledger = await upgrade`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
  await runMigrations(upgrade, source);
  assert.deepEqual(await retained(), before, "Every old row and grant remains unchanged");
  assert.equal((await upgrade`SELECT scheduling_mode FROM bookings WHERE id=${booking}`)[0].scheduling_mode, "working_hours");
  assert.deepEqual(await catalog(upgrade), await catalog(fresh));
  const after = await upgrade`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(after.length, 40); assert.deepEqual([...after].slice(0, 39), [...ledger]);
  await runMigrations(upgrade, source); assert.deepEqual(await upgrade`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`, after);
  const snapshot = JSON.parse(readFileSync(join(source, "meta/0039_snapshot.json"), "utf8"));
  const previous = JSON.parse(readFileSync(join(source, "meta/0038_snapshot.json"), "utf8"));
  assert.equal(snapshot.prevId, previous.id); assert.deepEqual(Object.keys(snapshot.tables).sort(), Object.keys(previous.tables).sort());
  assert(snapshot.tables['public.bookings'].columns.scheduling_mode);
  console.log(JSON.stringify({ result: "PASS", fresh: "0000→0039", upgrade: "0038→0039", catalogEqual: true, retainedTables: names.length, retainedLedgerRows: ledger.length, replay: "unchanged", snapshot: "complete cumulative" }));
} finally {
  for (const { name, sql } of clients) { await sql.end(); await admin.unsafe(`DROP DATABASE "${name}"`); }
  await admin.end(); rmSync(temporary, { recursive: true, force: true });
}
