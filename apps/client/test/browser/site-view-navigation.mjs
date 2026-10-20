import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Site view navigation' });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const active = id => page.locator(`[data-view-id="${id}"][data-state="active"]`).waitFor();
const navigateInApp = async url => page.evaluate(url => {
  history.pushState(history.state, '', url);
  dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}, url);
try {
  const makeTable = async name => {
    const table = await api('/tables', { name });
    const title = (await api(`/tables/${table.id}`)).columns[0];
    const grid = await command('createGridView', { tableId: table.id, name: 'Default grid' });
    const site = await command('createView', { tableId: table.id, type: 'site', name: `${name} site`, config: { template: 'blog', mapping: { title: title.id }, authorName: 'Public', description: '', language: 'en', articles: [] }, idempotencyKey: crypto.randomUUID() });
    return { table, title, grid, site };
  };
  const a = await makeTable('Navigation A'), b = await makeTable('Navigation B');
  const url = (fixture, id) => `/app/tables/${fixture.table.id}?view=${id}`;
  await page.goto(frontend + url(a, a.site.id)); await active(a.site.id); await page.getByTestId('blog-editor').waitFor();
  await page.reload(); await active(a.site.id); await page.getByTestId('blog-editor').waitFor();
  // Router updates without remounting the table page must follow the new query.
  await navigateInApp(url(a, a.grid.id)); await active(a.grid.id);
  await navigateInApp(url(a, a.site.id)); await active(a.site.id);
  await page.locator(`[data-view-id="${a.grid.id}"]`).click(); await active(a.grid.id);
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'listViews');
  await page.evaluate(async () => { const { api } = await import('/src/lib/api.ts'); await api.addRow(new URL(location.href).pathname.split('/').at(-1), {}); });
  await refreshed; await active(a.grid.id);
  assert.equal(new URL(page.url()).searchParams.get('view'), a.site.id, 'data refresh must preserve a valid manual selection over the unchanged query');
  await navigateInApp(url(b, b.site.id)); await active(b.site.id); await page.getByTestId('blog-editor').waitFor();
  await navigateInApp(url(a, b.site.id)); await active(a.grid.id); // Foreign table view is rejected.
  await navigateInApp(url(a, crypto.randomUUID())); await active(a.grid.id);
  await navigateInApp(`/app/tables/${b.table.id}`); await active(b.grid.id);
  // The actual Sites page creation path supplies a deep link to the new view.
  await page.goto(frontend + '/app/sites');
  await page.getByRole('button', { name: '新建站点视图', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '视图名称', exact: true }).fill('Created from sites');
  await dialog.getByRole('combobox', { name: '来源表格', exact: true }).click();
  await page.getByRole('option', { name: a.table.name, exact: true }).click();
  await dialog.getByRole('combobox', { name: '标题', exact: true }).click();
  await page.getByRole('option', { name: a.title.name, exact: true }).click();
  await dialog.getByRole('button', { name: '新建站点视图', exact: true }).click();
  await page.waitForURL(value => value.pathname === `/app/tables/${a.table.id}` && !!value.searchParams.get('view'));
  const createdId = new URL(page.url()).searchParams.get('view');
  assert.notEqual(createdId, a.site.id); await active(createdId); await page.getByTestId('blog-editor').waitFor();
  await page.reload(); await active(createdId); await page.getByTestId('blog-editor').waitFor();
  assert.deepEqual(f.errors, []);
  console.log('PASS site view navigation: default grid + direct link/reload, same-table query, manual selection across data refresh, table changes/invalid/foreign views, Sites creation redirect and reload.');
} finally { await f.close(); }
