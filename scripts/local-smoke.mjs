import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.LOCAL_PREVIEW_URL || "http://localhost:3301");
assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Local smoke only accepts a loopback origin");
const cookies = new Map();
let tableId;
async function request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(new URL(`/api${path}`, base), {
    method, headers: { "content-type": "application/json", origin: base.origin,
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const value = cookie.split(";")[0], position = value.indexOf("=");
    cookies.set(value.slice(0, position), value.slice(position + 1));
  }
  assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
const command = async (name, input) => (await request("/commands", { command: name, input })).result;
try {
  assert.equal((await request("/health")).ok, true);
  await request("/auth/sign-in/email", { email: process.env.SMOKE_EMAIL || "demo@tabdo.ai", password: process.env.SMOKE_PASSWORD || "Demo1234!" });
  const organizations = await request("/auth/organization/list");
  assert(organizations.length, "Seed a demo workspace before the local smoke");
  await request("/auth/organization/set-active", { organizationId: organizations[0].id });
  console.log("PASS health, login and workspace selection");
  const table = await request("/tables", { name: `Local Node smoke ${randomUUID()}` });
  tableId = table.id;
  const schema = await command("getTable", { tableId });
  const count = await command("addColumn", { tableId, name: "自动化结果", type: "number" });
  const rule = await command("createAutomation", { tableId, name: "Local worker smoke", trigger: { type: "row_created" },
    actions: [{ type: "update_field", columnId: count.id, value: 42 }] });
  const row = await command("addRow", { tableId, cells: { [schema.columns[0].id]: "Real API → outbox → Redis → worker", [count.id]: 0 } });
  console.log("PASS table, column, row creation and automation admission");
  const deadline = Date.now() + 20000;
  let saved, runs;
  do {
    saved = await command("getRow", { rowId: row.id });
    runs = await command("listAutomationRuns", { tableId, automationId: rule.id });
    if (saved.cells[count.id] === 42 && runs.some(run => run.status === "completed")) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  assert.equal(saved.cells[count.id], 42, "The real worker must commit its update");
  assert(runs.some(run => run.status === "completed"), "The automation must have a completed receipt");
  console.log("PASS transactional outbox, Redis delivery and actual worker writeback");
  await command("updateCell", { rowId: row.id, columnId: count.id, value: 43, expectedVersion: saved.version });
  assert.equal((await command("getRow", { rowId: row.id })).cells[count.id], 43);
  await command("deleteRow", { rowId: row.id });
  assert.equal((await command("queryRows", { tableId, limit: 10 })).rows.length, 0);
  console.log("PASS optimistic row update, deletion and windowed query");
} finally {
  if (tableId) await request(`/tables/${tableId}`, undefined, "DELETE");
}
console.log("PASS local Node flow; isolated smoke resources cleaned");
