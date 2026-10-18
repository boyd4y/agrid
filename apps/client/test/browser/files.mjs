import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

// This suite owns its Vite/API, independently of the runner's existing frontend.
process.env.BROWSER_BASE_URL = process.env.FILES_BROWSER_BASE_URL ?? 'http://localhost:5127';
process.env.BROWSER_API_PORT = process.env.FILES_BROWSER_API_PORT ?? '3123';
const { createBrowserFixture, frontend, workspace } = await import('./fixture.mjs');
const storageDirectory = await mkdtemp(join(tmpdir(), 'tabdo-files-browser-'));
// Set the local adapter's isolated directory before the fixture starts its API.
process.env.FILE_STORAGE_DRIVER = 'local';
process.env.FILE_STORAGE_LOCAL_DIR = storageDirectory;
let fixture, vite;
try {
  vite = await createServer({ root: join(workspace, 'apps/client'), configFile: join(workspace, 'apps/client/vite.config.ts'), server: { port: Number(new URL(frontend).port), strictPort: true, hmr: false, watch: null } });
  await vite.listen();
  fixture = await createBrowserFixture({ name: 'Files Browser' });
  const { page, api, ctx, browser, base, users, organizations, errors } = fixture;
  const bytes = [Buffer.from('Real UTF-8 attachment: 文件\n'), Buffer.from([0, 1, 127, 128, 255])];
  const attachments = [{ name: 'notes.txt', mimeType: 'text/plain', buffer: bytes[0] }, { name: 'data.bin', mimeType: 'application/octet-stream', buffer: bytes[1] }];
  const table = await api('/tables', { name: 'File records' });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const column = await api(`/tables/${table.id}/columns`, { name: '附件', type: 'file' });
  const single = await api(`/tables/${table.id}/columns`, { name: '单文件', type: 'file', config: { file: { multiple: false } } });
  const upload = async (columnId, files = attachments, context = ctx) => {
    const form = new FormData();
    for (const file of files) form.append('files', new Blob([file.buffer], { type: file.mimeType }), file.name);
    const cookies = (await context.cookies(base)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    return fetch(`${base}/api/tables/${table.id}/columns/${columnId}/files`, { method: 'POST', headers: { Origin: frontend, ...(cookies ? { Cookie: cookies } : {}) }, body: form });
  };
  const uploaded = await upload(column.id);
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const files = (await uploaded.json()).files;
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(file => [file.name, file.size, file.mimeType]), attachments.map(file => [file.name, file.buffer.length, file.mimeType]));
  for (let index = 0; index < files.length; index++) {
    assert.match(files[index].id, /^[0-9a-f-]{36}$/);
    const download = await ctx.request.get(`${base}/api/files/${files[index].id}/download`);
    assert(download.ok());
    assert.match(download.headers()['content-disposition'], /^attachment;/);
    assert.deepEqual(await download.body(), bytes[index]);
  }
  const ids = files.map(file => file.id);
  assert.deepEqual((await api(`/files?ids=${ids.join(',')}`)).files.map(file => file.id).sort(), [...ids].sort());
  const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: 'Attachments row', [column.id]: ids } });
  const rowValue = async rowId => (await api('/commands', { command: 'getRow', input: { rowId } })).result.cells[column.id];
  assert.deepEqual(await rowValue(row.id), ids);

  const rejected = async (path, input, method = 'POST', context = ctx, status = 400) => {
    const response = await context.request.fetch(base + '/api' + path, { method, headers: { Origin: frontend }, ...(input === undefined ? {} : { data: input }) });
    assert.equal(response.status(), status, `${path}: ${await response.text()}`);
  };
  await rejected(`/rows/${row.id}`, { cells: { [column.id]: [crypto.randomUUID()] } }, 'PATCH');
  const singleUpload = await upload(single.id, [attachments[0]]);
  assert.equal(singleUpload.status, 201);
  const singleId = (await singleUpload.json()).files[0].id;
  const secondSingleUpload = await upload(single.id, [attachments[1]]);
  assert.equal(secondSingleUpload.status, 201);
  const secondSingleId = (await secondSingleUpload.json()).files[0].id;
  await api(`/rows/${row.id}`, { cells: { [single.id]: [singleId] } }, 'PATCH');
  await rejected(`/rows/${row.id}`, { cells: { [single.id]: [singleId, secondSingleId] } }, 'PATCH');
  await rejected(`/rows/${row.id}`, { cells: { [column.id]: [singleId] } }, 'PATCH');
  assert.deepEqual(await rowValue(row.id), ids, 'invalid references never replace existing IDs');
  assert.equal((await upload(single.id)).status, 400, 'single-file uploads reject two files');
  await rejected(`/columns/${column.id}`, { config: { file: { multiple: false } } }, 'PATCH');
  assert.deepEqual(await rowValue(row.id), ids, 'switching a populated multiple field to single does not truncate stored references');
  assert.notEqual((await api(`/tables/${table.id}`)).columns.find(c => c.id === column.id).config.file?.multiple, false);
  await api(`/rows/${row.id}`, { cells: { [column.id]: [ids[0]] } }, 'PATCH');
  await api(`/columns/${column.id}`, { config: { file: { multiple: false } } }, 'PATCH');
  assert.equal((await api(`/tables/${table.id}`)).columns.find(c => c.id === column.id).config.file.multiple, false);
  await api(`/columns/${column.id}`, { config: { file: { multiple: true } } }, 'PATCH');
  await api(`/rows/${row.id}`, { cells: { [column.id]: ids } }, 'PATCH');

  const rows = async () => (await api(`/tables/${table.id}/rows/query`, { limit: 100 })).rows;
  const snapshot = async () => (await rows()).map(row => ({ id: row.id, cells: row.cells })).sort((a, b) => a.id.localeCompare(b.id));
  const beforeBatch = await snapshot();
  await rejected('/commands', { command: 'batchAddRows', input: { tableId: table.id, rows: [{ cells: { [column.id]: [ids[0]] } }, { cells: { [column.id]: [crypto.randomUUID()] } }] } });
  assert.deepEqual(await snapshot(), beforeBatch, 'batch add rolls back its valid first item when another file reference is invalid');
  const added = (await api('/commands', { command: 'batchAddRows', input: { tableId: table.id, rows: [{ cells: { [column.id]: [ids[0]] } }, { cells: { [column.id]: [ids[1]] } }] } })).result;
  assert.equal(added.count, 2);
  const beforeUpdate = await snapshot();
  await rejected('/commands', { command: 'batchUpdateRows', input: { updates: [{ rowId: added.rowIds[0], cells: { [column.id]: [] } }, { rowId: added.rowIds[1], cells: { [column.id]: [singleId] } }] } });
  assert.deepEqual(await snapshot(), beforeUpdate, 'batch update preserves every row on a cross-column reference');
  await api('/commands', { command: 'batchUpdateRows', input: { updates: [{ rowId: added.rowIds[0], cells: { [column.id]: [] } }, { rowId: added.rowIds[1], cells: { [column.id]: ids } }] } });
  const filtered = async op => (await api(`/tables/${table.id}/rows/query`, { filters: [{ id: 'file-filter', columnId: column.id, op }] })).rows.map(row => row.id).sort();
  assert.deepEqual(await filtered('is_empty'), [added.rowIds[0]]);
  assert.deepEqual(await filtered('is_not_empty'), [row.id, added.rowIds[1]].sort());

  const outsider = await browser.newContext();
  try {
    await rejected(`/files?ids=${ids[0]}`, undefined, 'GET', outsider, 401);
    await rejected(`/files/${ids[0]}/download`, undefined, 'GET', outsider, 401);
    assert.equal((await upload(column.id, attachments, outsider)).status, 401);
    const otherApi = async (path, data) => {
      const response = await outsider.request.post(base + '/api' + path, { headers: { Origin: frontend }, data });
      assert(response.ok(), await response.text()); return response.json();
    };
    users.push((await otherApi('/auth/sign-up/email', { email: `files-${crypto.randomUUID()}@local.test`, password: 'Files-Test-123!', name: 'File outsider' })).user.id);
    organizations.push((await otherApi('/auth/organization/create', { name: 'Other files workspace', slug: 'files-' + crypto.randomUUID() })).id);
    await otherApi('/auth/organization/set-active', { organizationId: organizations.at(-1) });
    await rejected(`/files?ids=${ids.join(',')}`, undefined, 'GET', outsider, 404);
    await rejected(`/files/${ids[0]}/download`, undefined, 'GET', outsider, 404);
    assert.equal((await upload(column.id, attachments, outsider)).status, 404);
    await rejected('/commands', { command: 'updateCells', input: { rowId: row.id, cells: { [column.id]: ids } } }, 'POST', outsider);
    const otherTable = await otherApi('/tables', { name: 'Outsider file table' });
    const otherColumn = await otherApi(`/tables/${otherTable.id}/columns`, { name: 'Private attachments', type: 'file' });
    await rejected(`/tables/${otherTable.id}/rows`, { cells: { [otherColumn.id]: ids } }, 'POST', outsider);
  } finally { await outsider.close(); }

  await page.goto(frontend + `/app/tables/${table.id}`);
  const cell = rowId => page.locator(`[data-cell][data-row-id="${rowId}"][data-col-name="附件"]`);
  const openCell = async rowId => { await cell(rowId).focus(); await cell(rowId).press('Enter'); };
  const editor = page.getByTestId('file-editor');
  const save = (rowId, action) => Promise.all([page.waitForResponse(response => response.url().endsWith(`/api/rows/${rowId}`) && response.request().method() === 'PATCH' && response.ok()), action()]);
  const closeEditor = async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid="file-editor"]')?.getAttribute('aria-busy') === 'false');
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
  };
  await cell(row.id).getByRole('link', { name: 'notes.txt', exact: true }).waitFor();
  await page.getByRole('button', { name: '添加列', exact: true }).click();
  const addColumn = page.getByTestId('add-column-editor');
  await addColumn.getByPlaceholder('例如：备注').fill('UI 文件');
  await addColumn.getByRole('combobox').click();
  await page.getByRole('option', { name: '文件', exact: true }).click();
  assert.equal(await addColumn.getByRole('switch').getAttribute('aria-checked'), 'true');
  await addColumn.getByRole('switch').click();
  await addColumn.getByRole('button', { name: '添加', exact: true }).click();
  await addColumn.waitFor({ state: 'hidden' });
  const uiColumn = (await api(`/tables/${table.id}`)).columns.find(column => column.name === 'UI 文件');
  assert.equal(uiColumn.type, 'file'); assert.equal(uiColumn.config.file.multiple, false);
  await page.locator('[data-col-header="UI 文件"]').hover();
  await page.getByRole('button', { name: 'UI 文件列设置', exact: true }).click();
  const settings = page.getByTestId('column-settings-editor');
  assert.equal(await settings.getByRole('switch').getAttribute('aria-checked'), 'false');
  await settings.getByRole('switch').click();
  await settings.getByRole('button', { name: '保存', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  assert.equal((await api(`/tables/${table.id}`)).columns.find(column => column.id === uiColumn.id).config.file.multiple, true);
  await cell(row.id).getByText('+1', { exact: true }).waitFor();
  await openCell(row.id);
  await editor.locator(`[data-file-id="${ids[1]}"]`).waitFor();
  assert.equal(await editor.getByLabel('上传文件', { exact: true }).getAttribute('multiple'), '', 'multiple is the default picker mode');
  await save(row.id, () => editor.getByRole('button', { name: '移除 data.bin', exact: true }).click());
  assert.deepEqual(await rowValue(row.id), [ids[0]], 'removing one reference retains the other');
  await closeEditor();
  await page.reload();
  await cell(row.id).getByRole('link', { name: 'notes.txt', exact: true }).waitFor();
  assert.equal(await cell(row.id).getByText('+1', { exact: true }).count(), 0);
  assert((await api(`/files?ids=${ids[1]}`)).files.length === 1, 'removing a reference does not delete the uploaded object');

  await openCell(added.rowIds[0]);
  await save(added.rowIds[0], () => editor.getByLabel('上传文件', { exact: true }).setInputFiles(attachments));
  const pickerIds = await rowValue(added.rowIds[0]);
  assert.equal(pickerIds.length, 2);
  assert.deepEqual((await api(`/files?ids=${pickerIds.join(',')}`)).files.map(file => file.name), ['notes.txt', 'data.bin']);
  await closeEditor();
  await page.reload();
  await cell(added.rowIds[0]).getByRole('link', { name: 'notes.txt', exact: true }).waitFor();
  await cell(added.rowIds[0]).getByText('+1', { exact: true }).waitFor();

  await openCell(row.id);
  const uploadPath = `**/api/tables/${table.id}/columns/${column.id}/files`;
  await page.route(uploadPath, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture upload failed' }) }));
  await editor.getByLabel('上传文件', { exact: true }).setInputFiles([attachments[1]]);
  await editor.getByRole('alert').getByText('Fixture upload failed', { exact: true }).waitFor();
  assert.deepEqual(await rowValue(row.id), [ids[0]]);
  await editor.locator(`[data-file-id="${ids[0]}"]`).waitFor();
  await page.unroute(uploadPath);
  await save(row.id, () => editor.getByRole('button', { name: '重试', exact: true }).click());
  const beforeFailedSave = await rowValue(row.id);
  assert.equal(beforeFailedSave.length, 2, 'upload retry preserves the selected File and existing reference');
  assert.equal(beforeFailedSave[0], ids[0]);
  await closeEditor();

  await openCell(row.id);
  const savePath = `**/api/rows/${row.id}`;
  await page.route(savePath, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture cell save failed' }) }) : route.fallback());
  await editor.getByLabel('上传文件', { exact: true }).setInputFiles([attachments[1]]);
  await editor.getByRole('alert').getByText('Fixture cell save failed', { exact: true }).waitFor();
  assert.deepEqual(await rowValue(row.id), beforeFailedSave, 'failed cell save preserves every previously stored reference');
  await editor.locator(`[data-file-id="${ids[0]}"]`).waitFor();
  const draftIds = await editor.locator('[data-file-id]').evaluateAll(nodes => nodes.map(node => node.dataset.fileId));
  assert.equal(draftIds.length, beforeFailedSave.length + 1, 'uploaded draft remains available after save failure');
  let releaseRefresh;
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  const queryPath = `**/api/tables/${table.id}/rows/query`;
  await page.route(queryPath, async route => { await refreshGate; await route.fallback(); });
  const refreshing = page.waitForRequest(request => request.url().endsWith(`/api/tables/${table.id}/rows/query`));
  await page.evaluate(async tableId => { const { notifyDataChanged } = await import('/src/lib/data-changes.ts'); notifyDataChanged(tableId); }, table.id);
  await refreshing;
  try {
    await page.getByText('加载中…', { exact: true }).waitFor();
    assert.deepEqual(await editor.locator('[data-file-id]').evaluateAll(nodes => nodes.map(node => node.dataset.fileId)), draftIds, 'in-flight same-query refresh keeps the editor and every unsaved ID mounted');
  } finally { releaseRefresh(); }
  await page.getByText('加载中…', { exact: true }).waitFor({ state: 'hidden' });
  await page.unroute(queryPath);
  assert.deepEqual(await editor.locator('[data-file-id]').evaluateAll(nodes => nodes.map(node => node.dataset.fileId)), draftIds, 'completed refresh also keeps the unsaved draft');
  await page.unroute(savePath);
  await save(row.id, () => editor.getByRole('button', { name: '重试', exact: true }).click());
  assert.deepEqual(await rowValue(row.id), draftIds, 'retry saves the existing uploaded draft rather than uploading a duplicate');
  await closeEditor();

  await page.evaluate(record => window.dispatchEvent(new CustomEvent('tabdo:open-record', { detail: record })), { id: row.id, tableId: table.id, title: 'Attachments row' });
  const sheet = page.getByTestId('related-record-panel');
  await sheet.waitFor();
  const sheetFiles = sheet.locator(`[data-record-field="${column.id}"]`).getByTestId('file-editor');
  await sheetFiles.locator(`[data-file-id="${ids[0]}"]`).waitFor();
  await sheetFiles.getByLabel('上传文件', { exact: true }).setInputFiles([attachments[0]]);
  await page.waitForFunction(({ columnId, count }) => document.querySelector(`[data-testid="related-record-panel"] [data-record-field="${columnId}"] [data-testid="file-editor"]`)?.querySelectorAll('[data-file-id]').length === count, { columnId: column.id, count: draftIds.length + 1 });
  const sheetIds = await sheetFiles.locator('[data-file-id]').evaluateAll(nodes => nodes.map(node => node.dataset.fileId));
  await sheet.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
  assert.deepEqual(await rowValue(row.id), sheetIds);
  await sheet.getByRole('button', { name: '关闭记录', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.evaluate(record => window.dispatchEvent(new CustomEvent('tabdo:open-record', { detail: record })), { id: row.id, tableId: table.id, title: 'Attachments row' });
  await sheetFiles.locator(`[data-file-id="${sheetIds.at(-1)}"]`).getByRole('link', { name: 'notes.txt', exact: true }).waitFor();
  await sheet.getByRole('button', { name: '关闭记录', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });

  const formView = (await api('/commands', { command: 'createFormView', input: { tableId: table.id, name: 'Attachment form', fields: [{ columnId: title.id, required: true }, { columnId: column.id, required: true }], config: { layout: 'classic' } } })).result;
  await page.reload();
  await page.getByTestId('view-form').filter({ hasText: 'Attachment form' }).click();
  await page.getByTestId('form-designer').getByRole('button', { name: '填写', exact: true }).click();
  const form = page.getByTestId('table-form');
  await form.getByRole('textbox').fill('File form record');
  await form.getByLabel('上传文件', { exact: true }).setInputFiles([attachments[0]]);
  await form.getByRole('link', { name: 'notes.txt', exact: true }).waitFor();
  const formIds = await form.getByTestId('file-editor').locator('[data-file-id]').evaluateAll(nodes => nodes.map(node => node.dataset.fileId));
  await form.getByRole('button', { name: '提交', exact: true }).click();
  await page.getByTestId('table-form-success').waitFor();
  assert.deepEqual((await rows()).find(row => row.cells[title.id] === 'File form record').cells[column.id], formIds, 'authenticated form saves the uploaded file IDs');
  assert(formView.id);
  assert.deepEqual(errors, []);
  console.log('PASS files real multipart/binary download/IDs/tenant boundaries/single and column constraints/atomic batches/empty filters/UI column creation and modes/grid picker and reload/remove/upload retry/save retry/staged Sheet save/authenticated form; no model calls or screenshots');
} finally {
  if (fixture) await fixture.close();
  if (vite) await vite.close();
  await rm(storageDirectory, { recursive: true, force: true });
}
