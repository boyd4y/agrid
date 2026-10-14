import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

if (!process.env.DATABASE_URL?.endsWith("_agent_test")) throw new Error("Use a dedicated *_agent_test database");
const { db, client } = await import("../../src/db/index.js");
const { auth } = await import("../../src/auth/index.js");
const { commandsRoute } = await import("../../src/routes/commands.js");
const { addColumn, updateColumn } = await import("../../src/commands/columns.js");
const { organization, member, session, user, tables, columns } = await import("../../src/db/schema.js");
const app = new Hono().route("/api/commands", commandsRoute);
const organizationId = randomUUID(), tableId = randomUUID();
let userId = "", cookie = "";
const request = (command: string, input: unknown) => app.request("http://localhost:3001/api/commands", {
  method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ command, input }),
});
const storedColumns = () => db.select().from(columns).where(eq(columns.tableId, tableId));
before(async () => {
  const response = await auth.handler(new Request("http://localhost:3001/api/auth/sign-up/email", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ email: `commands-${randomUUID()}@local.test`, password: "Test-command-password-123!", name: "Command Test" }),
  }));
  assert.equal(response.status, 200);
  userId = (await response.json()).user.id;
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  await db.insert(organization).values({ id: organizationId, name: "Commands", slug: organizationId });
  await db.insert(member).values({ id: randomUUID(), organizationId, userId, role: "owner" });
  await db.update(session).set({ activeOrganizationId: organizationId }).where(eq(session.userId, userId));
  await db.insert(tables).values({ id: tableId, organizationId, name: "Columns" });
});
after(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId));
  if (userId) await db.delete(user).where(eq(user.id, userId));
  await client.end();
});

test("generic API and public column commands reject illegal inputs without DB writes", async () => {
  const column = await addColumn({ tableId, organizationId, actorId: userId, name: "Width", type: "text", width: 160 });
  const before = await storedColumns();
  for (const width of [-1, 0, 1.5]) {
    const response = await request("updateColumn", { columnId: column.id, width });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /width/);
    await assert.rejects(updateColumn({ columnId: column.id, organizationId, actorId: userId, width }), { name: "ZodError" });
    assert.equal((await request("addColumn", { tableId, name: "Invalid", type: "text", width })).status, 400);
    await assert.rejects(addColumn({ tableId, organizationId, name: "Invalid", type: "text", width }), { name: "ZodError" });
  }
  for (const name of [" ", "x".repeat(101)]) {
    assert.equal((await request("updateColumn", { columnId: column.id, name })).status, 400);
    await assert.rejects(updateColumn({ columnId: column.id, organizationId, name }), { name: "ZodError" });
  }
  for (const input of [
    { columnId: column.id, width: 200, unexpected: true },
    { columnId: column.id, width: 200, skipAutomation: true },
    { columnId: column.id, width: 200, actorId: "override" },
  ]) assert.equal((await request("updateColumn", input)).status, 400);
  assert.equal((await request("addRow", { tableId, cells: { [column.id]: [{}] } })).status, 400);
  assert.deepEqual(await storedColumns(), before);

  const response = await request("updateColumn", { columnId: column.id, width: 220, organizationId: randomUUID() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.width, 220);
  assert.equal((await storedColumns())[0].width, 220);
  await updateColumn({ columnId: column.id, organizationId, actorId: userId, width: 240 });
  assert.equal((await storedColumns())[0].width, 240);
  const created = await request("addColumn", { tableId, name: " Trimmed ", type: "text", width: 180 });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).result.name, "Trimmed");
  // Commands outside the registry retain their existing dispatch behavior.
  assert.equal((await request("getTable", { tableId })).status, 200);
  assert.equal((await request("notACommand", {})).status, 400);
});
