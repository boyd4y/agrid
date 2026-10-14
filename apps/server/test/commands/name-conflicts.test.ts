import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, tables } = await import("../../src/db/schema.js");
const cmds = await import("../../src/commands/index.js");
const org = randomUUID(), other = randomUUID(), scope = { organizationId: org };
before(async () => { await db.insert(organization).values([org, other].map(id => ({ id, name: "Name tests", slug: id }))); });
after(async () => { for (const id of [org, other]) await db.delete(organization).where(eq(organization.id, id)); await client.end(); });
const conflict = (type: string) => async (error: unknown) => {
  assert(error instanceof HTTPException); assert.equal(error.status, 409);
  assert.match(error.message, new RegExp(type));
  assert.deepEqual(await error.getResponse().json(), { error: error.message }); return true;
};
// assert.rejects validators must be synchronous; response JSON is checked separately.
const isConflict = (error: unknown) => error instanceof HTTPException && error.status === 409 && error.message.includes("同名");
const rawConflict = (error: unknown) => (error as { code?: string }).code === "23505";

test("database enforces scoped table names on insert/rename while allowing other organizations", async () => {
  const table = await cmds.createTable({ ...scope, name: " Customers " });
  assert.equal(table.name, "Customers");
  let error: unknown;
  try { await cmds.createTable({ ...scope, name: "customers" }); } catch (e) { error = e; }
  assert(isConflict(error)); await conflict("表格")(error);
  await cmds.createTable({ organizationId: other, name: "Customers" });
  const next = await cmds.createTable({ ...scope, name: "Prospects" });
  await assert.rejects(client`update tables set name='\tCUSTOMERS\n' where id=${next.id}`, rawConflict);
  await assert.rejects(client`insert into tables (organization_id,name) values (${org},' Customers ')`, rawConflict);
  await db.update(tables).set({ description: "Metadata remains editable" }).where(eq(tables.id, table.id));
});

test("column creation, rename and inverse relation names roll back atomically", async () => {
  const a = await cmds.createTable({ ...scope, name: "Columns" }), b = await cmds.createTable({ ...scope, name: "Target" });
  const first = await cmds.addColumn({ ...scope, tableId: a.id, name: "Amount", type: "text" });
  await cmds.addColumn({ ...scope, tableId: b.id, name: "Amount", type: "text" });
  await assert.rejects(cmds.addColumn({ ...scope, tableId: a.id, name: " amount ", type: "text" }), isConflict);
  await assert.rejects(client`insert into columns (table_id,name,type,sort_order) values (${a.id},'AMOUNT','text',20)`, rawConflict);
  await assert.rejects(cmds.batchAddColumns({ ...scope, tableId: a.id, columns: [{ name: "Extra", type: "text" }, { name: "extra", type: "text" }] }), isConflict);
  const second = await cmds.addColumn({ ...scope, tableId: a.id, name: "Note", type: "text" });
  const row = await cmds.addRow({ ...scope, tableId: a.id, cells: { [first.id]: "keep this" } });
  await assert.rejects(cmds.batchUpdateColumns({ ...scope, columns: [{ columnId: first.id, type: "number" }, { columnId: second.id, name: "Amount" }] }), isConflict);
  assert.equal((await cmds.getRow({ ...scope, rowId: row.id })).cells[first.id], "keep this");
  assert.equal((await cmds.getTable({ ...scope, tableId: a.id })).columns.find(c => c.id === first.id)?.type, "text");
  await assert.rejects(cmds.addColumn({ ...scope, tableId: a.id, name: "Peers", type: "relation", config: { relation: { targetTableId: b.id, inverseName: "Amount" } } }), isConflict);
  const names = (await cmds.getTable({ ...scope, tableId: a.id })).columns.map(c => c.name);
  assert.deepEqual(names, ["标题", "Amount", "Note"]);
  await assert.rejects(client`update columns set name='amount' where id=${second.id}`, rawConflict);
});

test("historical duplicates remain editable but cannot receive another duplicate", async () => {
  // Only isolated fixture database; migration must preserve existing duplicates.
  let ids: string[] = [];
  await client.begin(async sql => {
    await sql`alter table tables disable trigger tables_org_name_unique`;
    ids = (await sql`insert into tables (organization_id,name) values (${org},'Legacy'),(${org},'Legacy') returning id`).map(r => r.id);
    await sql`alter table tables enable trigger tables_org_name_unique`;
  });
  assert.equal(ids.length, 2);
  await client`update tables set name='Legacy',description='Edited' where id=${ids[0]}`;
  await assert.rejects(client`insert into tables (organization_id,name) values (${org},'legacy')`, rawConflict);
  await client`update tables set name='Legacy renamed' where id=${ids[1]}`;
});

test("concurrent direct SQL inserts accept exactly one same-scope name", async () => {
  for (const kind of ["table", "column"]) {
    const parent = kind === "column" ? (await cmds.createTable({ ...scope, name: "Concurrent column parent" })).id : org;
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => kind === "table"
      ? client`insert into tables (organization_id,name) values (${parent},'Concurrent')`
      : client`insert into columns (table_id,name,type,sort_order) values (${parent},'Concurrent','text',100)`));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    for (const result of results) if (result.status === "rejected") assert(rawConflict(result.reason));
  }
});

test("repeatable-read stale snapshots cannot bypass scoped names", async () => {
  let snapshotReady!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => snapshotReady = resolve), proceed = new Promise<void>(resolve => release = resolve);
  const stale = client.begin("isolation level repeatable read", async sql => {
    await sql`select id from organization where id=${org}`; snapshotReady(); await proceed;
    await sql`insert into tables (organization_id,name) values (${org},'Snapshot')`;
  });
  const checked = assert.rejects(stale, (error: unknown) => (error as { code?: string }).code === "40001");
  await ready; await client`insert into tables (organization_id,name) values (${org},'Snapshot')`; release(); await checked;
});
