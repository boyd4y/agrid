import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
assert(new URL(url).pathname.endsWith("_agent_test"));
test("legacy graphs migrate atomically into each enterprise default, preserving IDs, pin and opaque runtime state", async () => {
  const sql = postgres(url, { max: 1, prepare: false });
  const schema = `ws_migration_${randomUUID().replaceAll("-", "")}`;
  const folder = new URL("../../drizzle/", import.meta.url);
  const { entries } = JSON.parse(readFileSync(new URL("meta/_journal.json", folder), "utf8")) as { entries: { idx: number; tag: string }[] };
  const rollback = new Error("fixture rollback");
  try {
    await assert.rejects(sql.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}", public`);
      const apply = async (tag: string) => {
        const raw = readFileSync(new URL(`${tag}.sql`, folder), "utf8").replaceAll('"public".', `"${schema}".`).replaceAll('public.', `"${schema}".`);
        for (const statement of raw.split("--> statement-breakpoint").filter(value => value.trim())) await tx.unsafe(statement);
      };
      for (const entry of entries.filter(entry => entry.idx < 33)) await apply(entry.tag);
      const org = randomUUID(), other = randomUUID(), table = randomUUID(), uid = randomUUID(), thread = randomUUID(), rule = randomUUID(), run = randomUUID();
      await tx`INSERT INTO organization(id,name,slug,created_at) VALUES (${org},'Original','original',now()),(${other},'Other','other',now())`;
      await tx`INSERT INTO "user"(id,name,email,created_at,updated_at) VALUES (${uid},'Owner',${uid+'@local.test'},now(),now())`;
      await tx`INSERT INTO tables(id,organization_id,name,pinned) VALUES (${table},${org},'Existing table',true)`;
      await tx`INSERT INTO chat_threads(id,user_id,organization_id,client_id,custom) VALUES (${thread},${uid},${org},'existing',${tx.json({ resourceKey: "workspace", opaque: { value: [1, "keep"] } })})`;
      await tx`INSERT INTO automations(id,organization_id,source,name,trigger,actions) VALUES (${rule},${org},${tx.json({ kind: "schedule", cron: "0 * * * *", timeZone: "UTC" })},'History',${tx.json({ type: "schedule_due" })},'[]')`;
      await tx`INSERT INTO automation_runs(id,automation_id,rule_snapshot,trigger_type) VALUES (${run},${rule},${tx.json({ organizationId: org, id: rule, actions: [] })},'schedule_due')`;
      const profile = randomUUID(), runtime = randomUUID(), mem = randomUUID();
      const resume = { specificationVersion: "harness-v1", harnessId: "opaque-provider", type: "resume-session", data: { opaque: ["do not rewrite", 1] } };
      const snapshot = { arbitrary: { bytes: "unchanged" } };
      await tx`INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES (${mem},${org},${uid},'owner',now())`;
      await tx`INSERT INTO agent_profile(id,user_id,organization_id,member_id,display_name) VALUES (${profile},${uid},${org},${mem},'Global agent')`;
      await tx`INSERT INTO agent_runtime_sessions(id,thread_id,agent_profile_id,harness,mode,provider,sandbox_id,resume_state,workspace) VALUES (${runtime},${thread},${profile},'pi','local','local','preserve-me',${tx.json(resume)},${tx.json(snapshot)})`;
      const target = randomUUID(), title = randomUUID(), linked = randomUUID(), sourceRow = randomUUID(), targetRow = randomUUID(), relation = randomUUID(), file = randomUUID(), site = randomUUID(), revision = randomUUID(), key = randomUUID(), event = randomUUID();
      await tx`INSERT INTO tables(id,organization_id,name) VALUES (${target},${org},'Target')`;
      await tx`INSERT INTO columns(id,table_id,name,type) VALUES (${title},${table},'Title','text'),(${linked},${table},'Link','relation')`;
      await tx`INSERT INTO rows(id,table_id,cells) VALUES (${sourceRow},${table},${tx.json({ [title]: "Preserved row" })}),(${targetRow},${target},'{}')`;
      await tx`INSERT INTO table_relations(id,organization_id,source_table_id,target_table_id,source_column_id) VALUES (${relation},${org},${table},${target},${linked})`;
      await tx`UPDATE columns SET config=${tx.json({ relation: { relationId: relation, direction: "source", targetTableId: target, limit: "many" } })} WHERE id=${linked}`;
      await tx`INSERT INTO row_relations(relation_id,source_row_id,target_row_id) VALUES (${relation},${sourceRow},${targetRow})`;
      await tx`INSERT INTO table_views(table_id,name,type,is_default) VALUES (${table},'Pinned view','grid',true)`;
      await tx`INSERT INTO reports(organization_id,table_id,name,config) VALUES (${org},${table},'Historical report',${tx.json({ widgets: [{ id: randomUUID(), type: "metric", query: { tableId: table, metric: "count", valueColumnId: null } }] })})`;
      await tx`INSERT INTO file_objects(id,organization_id,table_id,column_id,name,size,mime_type,storage_driver,storage_key) VALUES (${file},${org},${table},${title},'Existing bytes',7,'text/plain','local',${file})`;
      await tx`INSERT INTO sites(id,organization_id,name) VALUES (${site},${org},'Published site')`;
      await tx`INSERT INTO site_revisions(id,site_id,version,files,assets,storage_driver) VALUES (${revision},${site},1,${tx.json([{ path: "index.html", content: "original source" }])},${tx.json({ "index.html": "immutable-key" })},'local')`;
      await tx`UPDATE sites SET published_revision_id=${revision} WHERE id=${site}`;
      await tx`INSERT INTO api_keys(id,user_id,organization_id,name,key_hash,prefix) VALUES (${key},${uid},${org},'Existing capability','preserved-hash','tab_preserved')`;
      await tx`INSERT INTO api_key_tables(key_id,table_id,can_read) VALUES (${key},${table},true)`;
      await tx`INSERT INTO automation_events(id,organization_id,table_id,row_id,snapshot) VALUES (${event},${org},${table},${sourceRow},${tx.json({ protocol: 1, marker: "keep snapshot" })})`;
      await tx`INSERT INTO automation_outbox(event_id,queue,payload) VALUES (${event},'original-queue',${tx.json({ protocol: 1, eventId: event, generation: 0 })})`;
      const untouched = new Map<string, unknown>();
      for (const name of ["columns", "rows", "table_views", "table_relations", "row_relations", "site_revisions", "api_keys", "api_key_tables", "agent_runtime_sessions", "automation_outbox"]) {
        untouched.set(name, await tx.unsafe(`SELECT to_jsonb(t) AS value FROM "${name}" t ORDER BY to_jsonb(t)::text`));
      }
      const previous = await tx`SELECT id,cells FROM rows WHERE table_id=${table}`;
      const originalThread = (await tx`SELECT * FROM chat_threads WHERE id=${thread}`)[0];
      const migration = entries.find(entry => entry.idx === 33)!;
      // Inject a failure after all writes and prove rollback, then apply the same migration successfully.
      await assert.rejects(tx.savepoint(async nested => {
        const raw = readFileSync(new URL(`${migration.tag}.sql`, folder), "utf8").replaceAll('"public".', `"${schema}".`).replaceAll('public.', `"${schema}".`);
        for (const statement of raw.split("--> statement-breakpoint").filter(value => value.trim())) await nested.unsafe(statement);
        throw new Error("injected migration failure");
      }), /injected migration failure/);
      assert.equal((await tx`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=${schema} AND table_name='tables' AND column_name='workspace_id'`)[0].n, 0);
      await apply(migration.tag);
      const [a] = await tx`SELECT * FROM workspaces WHERE organization_id=${org} AND is_default`;
      assert.equal((await tx`SELECT count(*)::int AS n FROM workspaces`)[0].n, 2);
      const [updated] = await tx`SELECT * FROM tables WHERE id=${table}`; assert.equal(updated.workspace_id, a.id); assert.equal(updated.pinned, true);
      assert.deepEqual(await tx`SELECT id,cells FROM rows WHERE table_id=${table}`, previous);
      const [savedThread] = await tx`SELECT * FROM chat_threads WHERE id=${thread}`;
      const { workspace_id: _, ...unchanged } = savedThread; assert.deepEqual(unchanged, originalThread);
      const [native] = await tx`SELECT resume_state,workspace FROM agent_runtime_sessions WHERE id=${runtime}`;
      assert.deepEqual(native.resume_state, resume); assert.deepEqual(native.workspace, snapshot);
      for (const [name, original] of untouched) assert.deepEqual(await tx.unsafe(`SELECT to_jsonb(t) AS value FROM "${name}" t ORDER BY to_jsonb(t)::text`), original, `${name} stays unchanged`);
      for (const name of ["tables", "reports", "file_objects", "sites", "chat_threads", "automations"]) {
        assert.equal((await tx.unsafe(`SELECT count(*)::int AS n FROM "${name}" WHERE workspace_id IS NULL`))[0].n, 0);
      }
      assert.equal((await tx`SELECT workspace_id FROM automation_events WHERE id=${event}`)[0].workspace_id, a.id);
      assert.equal((await tx`SELECT published_revision_id FROM sites WHERE id=${site}`)[0].published_revision_id, revision);
      const [savedRun] = await tx`SELECT * FROM automation_runs WHERE id=${run}`; assert.equal(savedRun.workspace_id, a.id); assert.equal(savedRun.rule_snapshot.workspaceId, a.id);
      await tx`INSERT INTO workspaces(organization_id,name) VALUES (${org},'Empty B')`;
      const [b] = await tx`SELECT id FROM workspaces WHERE organization_id=${org} AND NOT is_default`;
      await tx`INSERT INTO tables(organization_id,workspace_id,name) VALUES (${org},${b.id},'Existing table')`;
      await tx`INSERT INTO organization(id,name,slug,created_at) VALUES (${randomUUID()},'New enterprise',${randomUUID()},now())`;
      assert.equal((await tx`SELECT count(*)::int AS n FROM workspaces WHERE is_default`)[0].n, 3);
      await assert.rejects(tx.savepoint(nested => nested`UPDATE tables SET workspace_id=${b.id} WHERE id=${table}`), /Resource workspace cannot change/);
      throw rollback;
    }), error => error === rollback);
  } finally { await sql.end(); }
});
