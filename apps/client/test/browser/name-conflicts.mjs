import assert from "node:assert/strict";
import { createBrowserFixture } from "./fixture.mjs";
const fixture = await createBrowserFixture({ name: "Scoped name HTTP checks" });
const { api, ctx, base } = fixture;
const fails = async (path, data, method = "POST") => {
  const response = await ctx.request.fetch(base + '/api' + path, { method, data });
  assert.equal(response.status(), 409);
  const body = await response.json(); assert.match(body.error, /同名/); assert(!body.error.includes('insert into'));
};
try {
  const a = await api('/tables', { name: 'Customers' });
  const b = await api('/tables', { name: 'Prospects' });
  await fails('/tables', { name: ' customers ' });
  await fails(`/tables/${b.id}`, { name: 'CUSTOMERS' }, 'PATCH');
  const field = await api(`/tables/${a.id}/columns`, { name: 'Email', type: 'text' });
  await fails(`/tables/${a.id}/columns`, { name: ' email ', type: 'text' });
  await fails('/commands', { command: 'batchAddColumns', input: { tableId: a.id, columns: [{ name: 'Phone', type: 'text' }, { name: 'EMAIL', type: 'text' }] } });
  assert.equal((await api(`/tables/${a.id}`)).columns.length, 2);
  assert.equal(field.name, 'Email');
  console.log('PASS: table/column/batch HTTP conflicts return actionable JSON409, batch rollback preserves fields.');
} finally { await fixture.close(); }
