import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
const f = await createBrowserFixture({ name: 'Unified CRUD key' });
const { page, api, frontend, base } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const call = async (secret, command, input, status = 200) => {
  const response = await fetch(base + '/api/commands', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ command, input }) });
  assert.equal(response.status, status, await response.clone().text()); return status === 200 ? (await response.json()).result : null;
};
try {
  const table = await api('/tables', { name: 'CRUD content' }), title = (await api(`/tables/${table.id}`)).columns[0];
  const workspace = (await command('getWorkspace')).workspace, label = `${workspace.name} / CRUD content`;
  const row = await command('addRow', { tableId: table.id, cells: { [title.id]: 'Original' } });
  await page.goto(frontend + '/app/settings?tab=api-keys');
  const panel = page.getByTestId('api-keys-settings'), dialog = page.getByRole('dialog');
  const createKey = async (name, operations) => {
    await panel.getByRole('button', { name: /^(创建接入配置|创建另一份)$/, exact: true }).click();
    await dialog.getByRole('textbox', { name: '名称', exact: true }).fill(name);
    assert.equal(await dialog.getByTestId(`resource-access-${table.id}`).getByRole('checkbox').count(), 4);
    for (const operation of operations) await dialog.getByRole('checkbox', { name: `${label} · ${operation}`, exact: true }).check();
    const createdResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/user/api-keys' && r.ok());
    await dialog.getByRole('button', { name: '生成接入配置', exact: true }).click();
    const secret = (await (await createdResponse).json()).secret;
    await dialog.waitFor({ state: 'hidden' }); return secret;
  };
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private body' }] }] };
  const creator = await createKey('Create-only', ['新增']);
  const created = await call(creator, 'addRow', { tableId: table.id, body: { content }, idempotencyKey: crypto.randomUUID() });
  assert(!JSON.stringify(created).includes('Private body'));
  await call(creator, 'getRow', { rowId: created.id, includeBody: true }, 403);
  await call(creator, 'updateCells', { rowId: row.id, body: { content, expectedVersion: 0 }, idempotencyKey: crypto.randomUUID() }, 403);
  const updater = await createKey('Update-only', ['更新']);
  const receipt = await call(updater, 'updateCells', { rowId: row.id, body: { content, expectedVersion: 0 }, idempotencyKey: crypto.randomUUID() });
  assert.equal(receipt.bodyVersion, 1); assert(!('body' in receipt)); assert(!('cells' in receipt));
  await call(updater, 'getRow', { rowId: row.id, includeBody: true }, 403);
  const editor = await createKey('Read + Update', ['读取', '更新']);
  assert.deepEqual((await call(editor, 'getRow', { rowId: row.id, includeBody: true })).body.content, content);
  await call(editor, 'createView', { tableId: table.id, type: 'site', name: 'CRUD site', config: { template: 'blog', authorName: 'Public', description: '', language: 'en', mapping: { title: title.id }, articles: [{ rowId: row.id, imageIds: [] }] }, idempotencyKey: crypto.randomUUID() }, 403);
  const saved = (await api('/user/api-keys')).keys.find(key => key.name === 'Read + Update');
  assert(!('documentPermissions' in saved)); assert(!('blogPermissions' in saved));
  await api(`/user/api-keys/${saved.id}`, undefined, 'DELETE');
  await call(editor, 'getRow', { rowId: row.id }, 401);
  assert.deepEqual(f.errors, []); console.log('PASS unified Key UI: four CRUD only, create-with-body, first existing-row save under Update, no-Read receipts, site configuration denied even with Read+Update and live revocation.');
} finally { await f.close(); }
