import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID as id } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate.js";
import { finalizeUnifiedSites } from "../../src/db/finalize-unified-sites.js";
const endpoint = new URL(process.env.DATABASE_URL!);
assert(endpoint.pathname.endsWith("_agent_test")); assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
const source = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"));
const oldMigration = journal.entries.filter((entry: { idx: number }) => entry.idx < 41);

test("populated pre-cutover migration preserves data/grants/public bytes, bridges old writes and finalizes only after reconciliation", { timeout: 60000 }, async () => {
  const admin = postgres(endpoint.toString(), { max: 1, onnotice: () => {} });
  const database = `unified_${id().replaceAll("-", "")}_agent_test`;
  const temp = mkdtempSync(join(tmpdir(), "tabdo-unified-migration-"));
  let sql: ReturnType<typeof postgres> | undefined, writer: ReturnType<typeof postgres> | undefined;
  try {
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    const url = new URL(endpoint); url.pathname = `/${database}`;
    sql = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    writer = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    cpSync(source, temp, { recursive: true }); writeFileSync(join(temp, "meta/_journal.json"), JSON.stringify({ ...journal, entries: oldMigration }));
    await runMigrations(sql, temp);
    const org = id(), table = id(), row = id(), doc = id(), image = id(), liveSite = id(), draftSite = id(), codeSite = id(), revision = id(), codeRevision = id(), title = id();
    await sql`INSERT INTO organization(id,name,slug) VALUES (${org},'Migration fixture',${org})`;
    const [workspace] = await sql`SELECT id FROM workspaces WHERE organization_id=${org} AND is_default`;
    await sql`INSERT INTO tables(id,organization_id,workspace_id,name) VALUES (${table},${org},${workspace.id},'Old ordinary table')`;
    await sql`INSERT INTO columns(id,table_id,name,type) VALUES (${title},${table},'Title','text')`;
    await sql`INSERT INTO rows(id,table_id,cells) VALUES (${row},${table},${sql.json({ [title]: "Retained" })})`;
    const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original body" }] }] };
    await sql`INSERT INTO record_documents(id,organization_id,workspace_id,source_table_id,source_row_id,content,version) VALUES (${doc},${org},${workspace.id},${table},${row},${sql.json(body)},7)`;
    await sql`INSERT INTO record_document_links(document_id,row_id,table_id,workspace_id,organization_id) VALUES (${doc},${row},${table},${workspace.id},${org})`;
    await sql`INSERT INTO document_images(id,document_id,name,mime_type,size,storage_driver,storage_key) VALUES (${image},${doc},'Original.png','image/png',1,'local','original-owned-key')`;
    // Independent old table/body/blog grant combinations must remain byte-identical,
    // and only the original table grant is consulted by the new runtime.
    for (const family of ["ordinary", "body-only", "blog-only", "read-only", "write-only"]) {
      const key = id(); await sql`INSERT INTO api_keys(id,organization_id,name,key_hash,prefix) VALUES (${key},${org},${family},${`hash:${family}`},'tab_old')`;
      if (family !== "body-only" && family !== "blog-only") await sql`INSERT INTO api_key_tables(key_id,table_id,can_read,can_update) VALUES (${key},${table},${family !== "write-only"},${family !== "read-only"})`;
      if (family === "body-only") await sql`INSERT INTO api_key_documents(key_id,table_id,can_read,can_update) VALUES (${key},${table},true,true)`;
      if (family === "blog-only") await sql`INSERT INTO api_key_blogs(key_id,table_id,can_read,can_publish) VALUES (${key},${table},true,true)`;
    }
    const config = { tableId: table, authorName: "Public", description: "Original", language: "en", mapping: { title }, articles: [{ rowId: row, imageIds: [] }] };
    for (const site of [liveSite, draftSite]) await sql`INSERT INTO sites(id,organization_id,workspace_id,kind,name,blog_config) VALUES (${site},${org},${workspace.id},'blog','Original site',${sql.json(config)})`;
    await sql`INSERT INTO sites(id,organization_id,workspace_id,name) VALUES (${codeSite},${org},${workspace.id},'Code without a table')`;
    await sql`INSERT INTO site_revisions(id,site_id,version,files,blog_config,assets,storage_driver) VALUES (${revision},${liveSite},1,'[{"path":"index.html","content":"Original public HTML"}]'::jsonb,${sql.json(config)},'{"index.html":"original-public-key"}'::jsonb,'local')`;
    await sql`UPDATE sites SET published_revision_id=${revision} WHERE id=${liveSite}`;
    await sql`INSERT INTO site_revisions(id,site_id,version,files,assets,storage_driver) VALUES (${codeRevision},${codeSite},1,'[{"path":"index.html","content":"<script>original()</script>"}]'::jsonb,'{"index.html":"code-key"}'::jsonb,'local')`;
    await sql`UPDATE sites SET published_revision_id=${codeRevision} WHERE id=${codeSite}`;
    const retained = async () => {
      const data: Record<string, unknown> = {};
      for (const name of ["sites", "site_revisions", "tables", "columns", "rows", "record_documents", "record_document_links", "document_images", "blog_asset_snapshots", "api_keys", "api_key_tables", "api_key_documents", "api_key_blogs"]) data[name] = await sql!.unsafe(`SELECT to_jsonb(t) AS value FROM "${name}" t ORDER BY to_jsonb(t)::text`);
      return data;
    };
    await sql`INSERT INTO blog_asset_snapshots(revision_id,path,base64) VALUES (${revision},'assets/original.png','aW1tdXRhYmxlLW9yaWdpbmFsLWJ5dGVz')`;
    const before = await retained();
    // Failure after backfill rolls schema, views, bridge and ledger back together.
    const broken = readFileSync(join(source, "0041_unified_record_site.sql"), "utf8") + "\n--> statement-breakpoint\nSELECT 1 / 0;";
    writeFileSync(join(temp, "0041_unified_record_site.sql"), broken); writeFileSync(join(temp, "meta/_journal.json"), JSON.stringify(journal));
    await assert.rejects(runMigrations(sql, temp));
    assert.equal((await sql`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_name='table_views' AND column_name='site_id'`)[0].count, 0);
    assert.deepEqual(await retained(), before);
    await runMigrations(sql, source);
    assert.deepEqual(await retained(), before);
    assert.equal((await sql`SELECT count(*)::int AS count FROM table_views WHERE type='site'`)[0].count, 2);
    assert.equal((await sql`SELECT count(*)::int AS count FROM table_views WHERE site_id=${codeSite}`)[0].count, 0);
    // Simulate an old API transaction already running after preDeploy, and keep it
    // open while the new operator readback runs. Commit causes an atomic mirror.
    const late = id(); let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
    const oldWrite = writer.begin(async tx => {
      await tx`INSERT INTO sites(id,organization_id,workspace_id,kind,name,blog_config) VALUES (${late},${org},${workspace.id},'blog','Late old API',${tx.json(config)})`;
      await tx`UPDATE sites SET name='Late config',blog_config=jsonb_set(blog_config,'{description}','"Late description"') WHERE id=${draftSite}`;
      entered(); await hold;
    });
    await ready;
    assert.equal((await finalizeUnifiedSites(sql)).sites, 2, "uncommitted old writer is not mistaken for a published result");
    release(); await oldWrite;
    const check = await finalizeUnifiedSites(sql); assert.equal(check.sites, 3); assert.equal(check.views, 3); assert.equal(check.bridge, true);
    assert.equal((await sql`SELECT name FROM table_views WHERE site_id=${draftSite}`)[0].name, "Late config");
    assert.equal((await sql`SELECT published_revision_id FROM sites WHERE id=${liveSite}`)[0].published_revision_id, revision);
    // Reconciliation failure leaves the temporary bridge installed and all rows.
    await sql`UPDATE table_views SET name='Mismatch' WHERE site_id=${late}`;
    await assert.rejects(finalizeUnifiedSites(sql, true), /reconciliation failed/);
    assert.equal((await sql`SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='unified_site_view_cutover'`)[0].count, 1);
    await writer`UPDATE sites SET name=name WHERE id=${late}`;
    // Old writer has ended. Finalization takes bounded table locks and removes
    // only the temporary bridge. This does not prove live Railway process drain.
    const done = await finalizeUnifiedSites(sql, true); assert.equal(done.finalized, true);
    assert.equal((await sql`SELECT count(*)::int AS count FROM pg_trigger WHERE tgname='unified_site_view_cutover'`)[0].count, 0);
    assert.equal((await sql`SELECT published_revision_id FROM sites WHERE id=${liveSite}`)[0].published_revision_id, revision);
    assert.deepEqual((await sql`SELECT content,version FROM record_documents WHERE id=${doc}`)[0], { content: body, version: 7 });
  } finally {
    await writer?.end(); await sql?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.end(); rmSync(temp, { recursive: true, force: true });
  }
});
