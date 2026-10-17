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
const namespace = process.env.HERDR_TEAM_NAMESPACE!;
assert(namespace && /^[a-z0-9_]+$/.test(namespace));
assert.equal(endpoint.pathname, `/${process.env.HERDR_TEAM_TEST_DATABASE}`);
assert(endpoint.pathname.startsWith(`/${namespace}_`));
assert.equal(process.env.DATABASE_URL, endpoint.toString());
assert.equal(process.env.DATABASE_URL_UNPOOLED, endpoint.toString());
const admin = postgres(endpoint.toString(), { max: 1 });
const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "tabdo-calendar-subscription-migrations-"));
const clients: Array<{ database: string; sql: ReturnType<typeof postgres> }> = [];
const hash = (tag: string) => createHash("sha256").update(readFileSync(join(source, `${tag}.sql`))).digest("hex");
function folder(name: string, include: (entry: { idx: number }) => boolean) {
  const path = join(temporary, name); cpSync(source, path, { recursive: true });
  writeFileSync(join(path, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter(include) }));
  return path;
}
async function database(name: string) {
  const database = `${namespace}_migration_${process.pid}_${name}_agent_test`;
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
  return { org, workspace: workspace.id as string, key, calendar, table, row, booking };
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
  const names = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  for (const { tablename } of names) {
    if (["calendar_subscriptions", "calendar_events", "calendar_deliveries", "calendar_delivery_attempts"].includes(tablename)) continue;
    const value = tablename === "api_key_calendars" ? "to_jsonb(t)-'can_subscribe'-'can_read_deliveries'-'can_manage_subscriptions'" : "to_jsonb(t)";
    data[tablename] = await sql.unsafe(`SELECT ${value} AS value FROM "${tablename}" t ORDER BY ${value}::text`);
  }
  return data;
}
async function seedBlogs(sql: ReturnType<typeof postgres>, ids: Awaited<ReturnType<typeof seedOld>>) {
  const site = randomUUID(), revision = randomUUID();
  await sql`UPDATE api_key_tables SET can_update=true WHERE key_id=${ids.key}`;
  await sql`UPDATE api_key_calendars SET can_read=true,can_trigger_agent=true WHERE key_id=${ids.key}`;
  await sql`UPDATE api_key_documents SET can_create=true,can_read_history=true WHERE key_id=${ids.key}`;
  await sql`INSERT INTO api_key_blogs(key_id,table_id,can_read,can_publish) VALUES (${ids.key},${ids.table},true,true)`;
  await sql`INSERT INTO sites(id,organization_id,workspace_id,name,kind,blog_config) VALUES (${site},${ids.org},${ids.workspace},'Published blog','blog','{"original":"configuration"}'::jsonb)`;
  await sql`INSERT INTO site_revisions(id,site_id,version,files,assets,storage_driver,blog_config,blog_manifest) VALUES (${revision},${site},1,'[{"path":"index.html","content":"preserved blog"}]'::jsonb,'{"index.html":"blog-storage-key"}'::jsonb,'local','{"original":"configuration"}'::jsonb,'{"original":"manifest"}'::jsonb)`;
  await sql`UPDATE sites SET published_revision_id=${revision} WHERE id=${site}`;
  await sql`INSERT INTO blog_asset_snapshots(revision_id,path,base64) VALUES (${revision},'image.png','aGVsbG8=')`;
  await sql`INSERT INTO blog_previews(token,site_id,revision_id,expires_at) VALUES ('preview-token',${site},${revision},'2035-01-01T00:00Z')`;
  await sql`INSERT INTO blog_publication_permits(token_hash,site_id,intent_hash,expires_at) VALUES ('permit-hash',${site},'intent-hash','2035-01-01T00:00Z')`;
  await sql`INSERT INTO blog_receipts(workspace_id,principal_id,command,key,request_hash,result) VALUES (${ids.workspace},${ids.key},'publishBlog','blog-receipt','blog-request-hash','{"original":"result"}'::jsonb)`;
  await sql`INSERT INTO blog_storage_garbage(driver,keys) VALUES ('local','["old-blog-key"]'::jsonb)`;
}
async function seedReminders(sql: ReturnType<typeof postgres>, ids: Awaited<ReturnType<typeof seedOld>>) {
  const uid = randomUUID(), rule = randomUUID(), reminder = randomUUID(), site = randomUUID(), revision = randomUUID();
  await sql`INSERT INTO "user"(id,name,email) VALUES (${uid},'Preserved author',${uid + '@local.test'})`;
  await sql`INSERT INTO automations(id,workspace_id,organization_id,name,source,trigger,actions) VALUES (${rule},${ids.workspace},${ids.org},'Preserved plan','{"kind":"schedule","cron":"0 10 * * *","timeZone":"UTC"}'::jsonb,'{"type":"schedule_due"}'::jsonb,'[]'::jsonb)`;
  await sql`INSERT INTO automation_schedules(automation_id,next_run_at,rule_version) VALUES (${rule},'2030-01-01T10:00Z',1)`;
  await sql`INSERT INTO api_key_schedules(key_id,automation_id,can_read) VALUES (${ids.key},${rule},true)`;
  await sql`INSERT INTO booking_reminders(id,workspace_id,booking_id,created_by_user_id,key_id,configuration,automation_id) VALUES (${reminder},${ids.workspace},${ids.booking},${uid},${ids.key},'{"kind":"before_start","offsetMinutes":30}'::jsonb,${rule})`;
  await sql`INSERT INTO booking_reminder_intents(workspace_id,booking_id,reminder_id,revision,kind,offset_minutes,scheduled_for) VALUES (${ids.workspace},${ids.booking},${reminder},1,'before_start',30,'2030-01-01T09:30Z')`;
  await sql`INSERT INTO sites(id,organization_id,workspace_id,name) VALUES (${site},${ids.org},${ids.workspace},'Published code site')`;
  await sql`INSERT INTO site_revisions(id,site_id,version,files,assets,storage_driver) VALUES (${revision},${site},1,'[{"path":"index.html","content":"preserved"}]'::jsonb,'{"index.html":"original-storage-key"}'::jsonb,'local')`;
  await sql`UPDATE sites SET published_revision_id=${revision} WHERE id=${site}`;
}
async function ledger(sql: ReturnType<typeof postgres>) {
  return sql`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
}
async function validate(sql: ReturnType<typeof postgres>) {
  const before = await ledger(sql), data = await retained(sql), schema = await catalog(sql);
  assert.equal(before.length, journal.entries.length);
  for (const entry of journal.entries) assert.equal(before.filter(value => value.hash === hash(entry.tag) && value.created_at === String(entry.when)).length, 1);
  for (const name of ["calendar_subscriptions", "calendar_events", "calendar_deliveries", "calendar_delivery_attempts"]) assert.equal((await sql.unsafe(`SELECT count(*)::integer AS n FROM "${name}"`))[0].n, 0);
  assert((await sql`SELECT can_subscribe,can_read_deliveries,can_manage_subscriptions FROM api_key_calendars`).every(value => Object.values(value).every(flag => flag === false)), "Existing Keys gain no outbound capability");
  await runMigrations(sql, source);
  assert.deepEqual(await ledger(sql), before); assert.deepEqual(await retained(sql), data); assert.deepEqual(await catalog(sql), schema);
  return before;
}
try {
  const through37 = folder("through37", entry => entry.idx <= 37);
  const fresh = await database("fresh"); await runMigrations(fresh, source);
  const freshCatalog = await catalog(fresh), evidence: Record<string, unknown> = { fresh: { ledger: await validate(fresh) } };
  const upgrade = await database("upgrade"); await runMigrations(upgrade, through37);
  const ids = await seedOld(upgrade); await seedDocuments(upgrade, ids); await seedReminders(upgrade, ids); await seedBlogs(upgrade, ids);
  const before = await retained(upgrade), ledgerBefore = await ledger(upgrade);
  assert.equal(ledgerBefore.at(-1)!.hash, hash("0037_blog_site_publishing"));
  await runMigrations(upgrade, source);
  assert.deepEqual(await retained(upgrade), before, "Keep every existing public row, Key hash/five grant families/documents/blogs/reminders/plans verbatim");
  const after = await validate(upgrade);
  for (const original of ledgerBefore) assert.deepEqual(after.find(value => value.id === original.id), original);
  assert.deepEqual(await catalog(upgrade), freshCatalog, "Fresh and actual 0037→0038 have identical columns/constraints/indexes/triggers");
  evidence.upgrade = { from: "0037", to: "0038", retainedTables: Object.keys(before), retainedLedgerRows: ledgerBefore.length, ledger: after, catalogDiff: [], implicitOutboundGrants: 0 };
  console.log(JSON.stringify(evidence, null, 2));
  console.log("PASS fresh 0000→0038, actual 0037→0038, all old rows/five grant families/Key hashes/documents/blogs/reminders/plans/ledger retained, replay and complete catalog equality");
} finally {
  for (const client of clients) { await client.sql.end(); await admin.unsafe(`DROP DATABASE "${client.database}"`); }
  await admin.end(); rmSync(temporary, { recursive: true, force: true });
}
