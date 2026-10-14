import assert from "node:assert/strict";
import { test } from "../runtime.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { auth } = await import("../../src/auth/index.js");
const { filesRoute } = await import("../../src/routes/files.js");
const { organization, member, session, user, tables, columns, fileObjects } = await import("../../src/db/schema.js");
const app = new Hono().route("/api", filesRoute);
app.onError((error, c) => "getResponse" in error && typeof error.getResponse === "function" ? error.getResponse() : c.json({ error: error.message }, 500));

test("upload failures clean partial S3 objects and recheck column ownership/config before committing", async () => {
  const orgId = randomUUID(), tableId = randomUUID(), columnId = randomUUID(); let userId = "", cookie = "";
  let mode: "fail-put" | "retype" = "fail-put", putCount = 0;
  const objects = new Map<string, Buffer>(), deletes: string[] = [], fixtureErrors: unknown[] = [];
  const fixture = createServer(async (request, response) => {
    try {
      assert.match(request.headers.authorization || "", /^AWS4-HMAC-SHA256/);
      const key = new URL(request.url!, "http://fixture").pathname;
      if (request.method === "PUT") {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        putCount++;
        if (mode === "fail-put" && putCount === 2) { response.writeHead(403, { "content-type": "application/xml" }); response.end("<Error><Code>AccessDenied</Code><Message>fixture failure</Message></Error>"); return; }
        objects.set(key, Buffer.concat(chunks));
        if (mode === "retype") await db.update(columns).set({ type: "text" }).where(eq(columns.id, columnId));
        response.writeHead(200); response.end();
      } else if (request.method === "DELETE") { deletes.push(key); objects.delete(key); response.writeHead(204); response.end(); }
      else throw new Error("Unexpected fixture operation");
    } catch (error) { fixtureErrors.push(error); response.writeHead(400); response.end(); }
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address(); assert(address && typeof address !== "string");
  const settings = { FILE_STORAGE_DRIVER: "s3", FILE_STORAGE_S3_ENDPOINT: `http://127.0.0.1:${address.port}`, FILE_STORAGE_S3_REGION: "us-east-1", FILE_STORAGE_S3_BUCKET: "failure-fixture", FILE_STORAGE_S3_ACCESS_KEY_ID: "failure-fixture", FILE_STORAGE_S3_SECRET_ACCESS_KEY: "failure-fixture-secret", FILE_STORAGE_S3_FORCE_PATH_STYLE: "true", FILE_UPLOAD_MAX_BYTES: "8", FILE_UPLOAD_MAX_FILES: "2", FILE_UPLOAD_MAX_REQUEST_BYTES: "4096" };
  const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const upload = (values: (Blob | string)[]) => {
    const form = new FormData(); values.forEach((value, i) => typeof value === "string" ? form.append("files", value) : form.append("files", value, `fixture-${i}.bin`));
    return app.request(`http://localhost:3001/api/tables/${tableId}/columns/${columnId}/files`, { method: "POST", headers: { Cookie: cookie }, body: form });
  };
  try {
    const signup = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ email: `files-${randomUUID()}@local.test`, password: "Test-file-password-123!", name: "File Test" }) }));
    assert.equal(signup.status, 200); userId = (await signup.json()).user.id;
    cookie = signup.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    await db.insert(organization).values({ id: orgId, name: "Storage Failure Test", slug: orgId });
    await db.insert(member).values({ id: randomUUID(), organizationId: orgId, userId, role: "owner" });
    await db.update(session).set({ activeOrganizationId: orgId }).where(eq(session.userId, userId));
    await db.insert(tables).values({ id: tableId, organizationId: orgId, name: "Storage test" });
    await db.insert(columns).values({ id: columnId, tableId, name: "Files", type: "file" });
    const small = new Blob([new Uint8Array([0, 255, 9])], { type: "application/octet-stream" });
    assert.equal((await upload([small, small])).status, 503);
    assert.equal(objects.size, 0); assert.equal(deletes.length, 2, "cleanup includes partially attempted objects");
    assert.equal((await db.select().from(fileObjects).where(eq(fileObjects.tableId, tableId))).length, 0);
    mode = "retype";
    assert.equal((await upload([small])).status, 400, "schema change during storage cannot commit invalid metadata");
    assert.equal(objects.size, 0); assert.equal(deletes.length, 3);
    assert.equal((await db.select().from(fileObjects).where(eq(fileObjects.tableId, tableId))).length, 0);
    await db.update(columns).set({ type: "file" }).where(eq(columns.id, columnId));
    const before = putCount;
    assert.equal((await upload(["invalid form field"])).status, 400);
    assert.equal((await upload([small, small, small])).status, 400);
    assert.equal((await upload([new Blob([new Uint8Array(9)])])).status, 413);
    process.env.FILE_UPLOAD_MAX_REQUEST_BYTES = "32";
    assert.equal((await upload([small])).status, 413, "stream body is bounded without Content-Length");
    assert.equal(putCount, before, "invalid input never reaches storage");
    assert.deepEqual(fixtureErrors, []);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await db.delete(organization).where(eq(organization.id, orgId));
    if (userId) await db.delete(user).where(eq(user.id, userId));
    await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
    await client.end();
  }
});
