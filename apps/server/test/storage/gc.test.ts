import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { organization, tables, columns, fileObjects, storageGcJobs } = await import("../../src/db/schema.js");
const { enqueueFileGc, runFileGcOnce } = await import("../../src/storage/gc.js");
const { getStorageAdapter } = await import("../../src/storage/adapter.js");
const { deleteColumn, deleteTable } = await import("../../src/commands/index.js");
test("GC removes orphans, protects live refs, and journals column/table/org cascades", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tabdo-gc-"));
  const oldDir = process.env.FILE_STORAGE_LOCAL_DIR;
  process.env.FILE_STORAGE_LOCAL_DIR = dir;
  const orgId = randomUUID(), tableId = randomUUID(), columnId = randomUUID();
  const adapter = getStorageAdapter("local");
  const identity = () => { const id = randomUUID(); return { id, organizationId: orgId, storageDriver: "local" as const, storageKey: `${id.slice(0, 2)}/${id}` }; };
  const orphan = identity(), live = identity();
  const sweep = async () => {
    await db.update(storageGcJobs).set({ availableAt: new Date(0) }).where(and(eq(storageGcJobs.organizationId, orgId), eq(storageGcJobs.status, "pending")));
    return runFileGcOnce({ limit: 1000 });
  };
  const missing = async (key: string) => assert.rejects(adapter.open(key), { code: "ENOENT" });
  const readable = async (key: string) => { const body = await adapter.open(key); assert.equal(await new Response(body).text(), "hello"); };
  try {
    await db.insert(organization).values({ id: orgId, name: "GC", slug: orgId });
    await db.insert(tables).values({ id: tableId, organizationId: orgId, name: "GC" });
    await db.insert(columns).values({ id: columnId, tableId, name: "Files", type: "file" });
    await adapter.put(orphan.storageKey, new Blob(["hello"]), "text/plain");
    await adapter.put(live.storageKey, new Blob(["hello"]), "text/plain");
    await db.insert(fileObjects).values({ ...live, tableId, columnId, name: "hello", size: 5, mimeType: "text/plain" });
    await enqueueFileGc(db, [orphan, live], new Date(0));
    assert.equal((await sweep()).failed, 0);
    await missing(orphan.storageKey); await readable(live.storageKey);
    await deleteColumn({ columnId, organizationId: orgId });
    assert((await db.select().from(storageGcJobs).where(and(eq(storageGcJobs.storageKey, live.storageKey), eq(storageGcJobs.status, "pending")))).length > 0);
    await sweep(); await missing(live.storageKey);
    for (const deletion of ["table", "org"]) {
      const next = identity(), nextColumn = randomUUID();
      await db.insert(columns).values({ id: nextColumn, tableId, name: "Files", type: "file" });
      await adapter.put(next.storageKey, new Blob(["hello"]), "text/plain");
      await db.insert(fileObjects).values({ ...next, tableId, columnId: nextColumn, name: "hello", size: 5, mimeType: "text/plain" });
      if (deletion === "table") {
        await deleteTable({ tableId, organizationId: orgId });
        await db.insert(tables).values({ id: tableId, organizationId: orgId, name: "GC" });
      } else await db.delete(organization).where(eq(organization.id, orgId));
      await sweep(); await missing(next.storageKey);
    }
  } finally {
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(storageGcJobs).where(eq(storageGcJobs.organizationId, orgId));
    if (oldDir === undefined) delete process.env.FILE_STORAGE_LOCAL_DIR; else process.env.FILE_STORAGE_LOCAL_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
    await client.end();
  }
});
