// Explicit disposable-database regression: MIGRATION_TEST_DATABASE_URL must be isolated and allow CREATEDB.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate.js";

const endpoint = new URL(process.env.MIGRATION_TEST_DATABASE_URL!);
assert(endpoint.pathname.endsWith("_agent_test"), "Use an explicit isolated migration test database");
assert.equal(process.env.DATABASE_URL, endpoint.toString());
assert.equal(process.env.DATABASE_URL_UNPOOLED, endpoint.toString());
const admin = postgres(endpoint.toString(), { max: 1 });
const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "tabdo-calendar-documents-migrations-"));
const clients: Array<{ database: string; sql: ReturnType<typeof postgres> }> = [];
const hash = (tag: string) => createHash("sha256").update(readFileSync(join(source, `${tag}.sql`))).digest("hex");
function folder(name: string, include: (entry: { idx: number }) => boolean) {
  const path = join(temporary, name); cpSync(source, path, { recursive: true });
  writeFileSync(join(path, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter(include) }));
  return path;
}
async function database(name: string) {
  const database = `calendar_documents_${process.pid}_${name}_agent_test`;
  await admin.unsafe(`CREATE DATABASE "${database}"`);
  const url = new URL(endpoint); url.pathname = `/${database}`;
  const sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
  clients.push({ database, sql }); return sql;
}
async function catalog(sql: ReturnType<typeof postgres>) {
  return {
    columns: await sql`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
    constraints: await sql`SELECT c.relname AS table_name, t.conname, t.contype, pg_get_constraintdef(t.oid) AS definition FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname, t.conname`,
    indexes: await sql`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    triggers: await sql`SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
  };
}
async function seedOld(sql: ReturnType<typeof postgres>) {
  const org = randomUUID(), key = randomUUID(), calendar = randomUUID(), table = randomUUID(), row = randomUUID(), person = randomUUID(), booking = randomUUID();
  await sql`INSERT INTO organization(id,name,slug) VALUES (${org},'Preserved org',${org})`;
  const [workspace] = await sql`SELECT id FROM workspaces WHERE organization_id=${org} AND is_default`;
  await sql`INSERT INTO api_keys(id,organization_id,name,key_hash,prefix) VALUES (${key},${org},'Preserved Key','preserved-original-key-hash','tab_original')`;
  await sql`INSERT INTO tables(id,organization_id,workspace_id,name) VALUES (${table},${org},${workspace.id},'Preserved articles')`;
  await sql`INSERT INTO rows(id,table_id,cells) VALUES (${row},${table},'{"original":"kept"}'::jsonb)`;
  await sql`INSERT INTO api_key_tables(key_id,table_id,can_read) VALUES (${key},${table},true)`;
  await sql`INSERT INTO calendars(id,organization_id,workspace_id,name,time_zone) VALUES (${calendar},${org},${workspace.id},'Preserved calendar','UTC')`;
  await sql`INSERT INTO calendar_people(id,workspace_id,name,time_zone) VALUES (${person},${workspace.id},'Person','UTC')`;
  await sql`INSERT INTO bookings(id,workspace_id,calendar_id,person_id,title,"start","end",time_zone) VALUES (${booking},${workspace.id},${calendar},${person},'Preserved appointment','2030-01-01T10:00Z','2030-01-01T11:00Z','UTC')`;
  await sql`INSERT INTO api_key_calendars(key_id,calendar_id,can_manage) VALUES (${key},${calendar},true)`;
  return { org, workspace: workspace.id as string, key, calendar, table, row };
}
async function seedDocuments(sql: ReturnType<typeof postgres>, ids: Awaited<ReturnType<typeof seedOld>>) {
  const doc = randomUUID(), image = randomUUID();
  await sql`INSERT INTO record_documents(id,organization_id,workspace_id,source_table_id,source_row_id,content) VALUES (${doc},${ids.org},${ids.workspace},${ids.table},${ids.row},'{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb)`;
  await sql`INSERT INTO record_document_links(document_id,row_id,table_id,workspace_id,organization_id) VALUES (${doc},${ids.row},${ids.table},${ids.workspace},${ids.org})`;
  await sql`INSERT INTO document_revisions(document_id,version,content) SELECT id,version,content FROM record_documents WHERE id=${doc}`;
  await sql`INSERT INTO document_images(id,document_id,name,mime_type,size,storage_driver,storage_key) VALUES (${image},${doc},'retained.png','image/png',1,'local',${image})`;
  await sql`INSERT INTO document_receipts(workspace_id,principal_id,command,key,request_hash,result) VALUES (${ids.workspace},${ids.key},'createDocument','original-receipt','original-request-hash','{}'::jsonb)`;
  await sql`INSERT INTO api_key_documents(key_id,table_id,can_read) VALUES (${ids.key},${ids.table},true)`;
}
async function retained(sql: ReturnType<typeof postgres>) {
  const data: Record<string, unknown> = {};
  for (const table of ["organization", "workspaces", "tables", "rows", "api_keys", "api_key_tables", "calendars", "calendar_people", "bookings", "record_documents", "record_document_links", "document_revisions", "document_images", "document_receipts", "api_key_documents"]) data[table] = await sql.unsafe(`SELECT to_jsonb(t) AS value FROM "${table}" t ORDER BY to_jsonb(t)::text`);
  // 0035 deliberately adds only the false can_trigger_agent field to an existing grant.
  data.api_key_calendars = await sql`SELECT key_id,calendar_id,can_read,can_read_availability,can_create,can_update,can_cancel,can_manage FROM api_key_calendars ORDER BY key_id,calendar_id`;
  return data;
}
async function validate(sql: ReturnType<typeof postgres>) {
  const ledger = await sql`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
  assert.equal(ledger.length, journal.entries.length);
  for (const entry of journal.entries) assert.equal(ledger.filter(value => value.hash === hash(entry.tag) && value.created_at === String(entry.when)).length, 1);
  const data = await retained(sql);
  await runMigrations(sql, source);
  assert.deepEqual(await sql`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`, ledger);
  assert.deepEqual(await retained(sql), data);
  assert.equal((await sql`SELECT count(*)::integer AS n FROM api_key_calendars WHERE can_trigger_agent`)[0].n, 0);
  for (const table of ["api_key_schedules", "booking_reminders", "booking_reminder_intents"]) assert.equal((await sql.unsafe(`SELECT count(*)::integer AS n FROM ${table}`))[0].n, 0);
  return ledger;
}
try {
  const baseline = folder("baseline", entry => entry.idx <= 34), through35 = folder("through35", entry => entry.idx <= 35), through36Only = folder("through36-only", entry => entry.idx <= 34 || entry.idx === 36);
  const fresh = await database("fresh"); await runMigrations(fresh, source); const freshCatalog = await catalog(fresh);
  const evidence: Record<string, unknown> = { fresh: { ledger: await validate(fresh) } };
  for (const order of ["35_then_36", "36_then_35"]) {
    const sql = await database(order); await runMigrations(sql, baseline); const ids = await seedOld(sql);
    if (order === "35_then_36") await runMigrations(sql, through35);
    await runMigrations(sql, through36Only); await seedDocuments(sql, ids);
    const before = await retained(sql), ledgerBefore = await sql`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    await runMigrations(sql, source);
    assert.deepEqual(await retained(sql), before, "Existing rows, keys, document bodies/history/images/receipts and grants survive");
    const ledger = await validate(sql);
    for (const original of ledgerBefore) assert.deepEqual(ledger.find(value => value.id === original.id), original, "Keep each existing ledger row verbatim");
    const schema = await catalog(sql); assert.deepEqual(schema, freshCatalog, "Both application orders produce identical columns, constraints, indexes and triggers");
    await assert.rejects(sql`UPDATE document_revisions SET content='{}'::jsonb`, /Document revisions are immutable/);
    await assert.rejects(sql`INSERT INTO api_key_documents(key_id,table_id) VALUES (${ids.key},${ids.table})`);
    await assert.rejects(sql`UPDATE record_document_links SET table_id=${randomUUID()}`);
    evidence[order] = { preservedTables: Object.keys(before), retainedLedgerRows: ledgerBefore.length, ledger, catalogDiff: [] };
  }
  evidence.catalog = freshCatalog;
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS fresh, actual 0034→35→36 and actual 0034→36→35, retained data/Key/document/ledger, no implicit grants, FK/check/immutable-trigger enforcement, full catalog equality and replay idempotency");
} finally {
  for (const client of clients) { await client.sql.end(); await admin.unsafe(`DROP DATABASE "${client.database}"`); }
  await admin.end(); rmSync(temporary, { recursive: true, force: true });
}
