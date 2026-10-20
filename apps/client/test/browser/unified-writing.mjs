import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath, pause } from './fixture.mjs';
const directory = artifactPath('unified-writing-files');
const f = await createBrowserFixture({ name: '统一写作验收', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory, SITE_PUBLIC_ORIGIN: `http://localhost:${process.env.BROWSER_API_PORT}`, REDIS_URL: process.env.REDIS_URL, QUEUE_PREFIX: process.env.HERDR_TEAM_REDIS_PREFIX } });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const nativeDialogs = []; page.on('dialog', dialog => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });
const command = async (command, input) => (await api('/commands', { command, input })).result;
const rowBody = async input => (await command('getRow', { rowId: input.rowId, includeBody: true })).body;
const saved = root => root.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
const body = root => root.getByRole('textbox', { name: '正文内容', exact: true });
try {
  const table = await api('/tables', { name: '记录本身就是页面' }), title = (await api(`/tables/${table.id}`)).columns[0];
  const content = await command('addColumn', { tableId: table.id, name: '内容', type: 'text' });
  const first = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '原始标题', [content.id]: '自建内容列保留' } });
  const second = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '另一条记录' } });
  const identity = { tableId: table.id, rowId: first.id };
  await page.goto(frontend + `/app/tables/${table.id}`);
  await page.getByTestId(`open-grid-record-${first.id}`).click();
  const panel = page.getByTestId('related-record-panel'); await body(panel).waitFor();
  assert.equal(await panel.locator('[data-rich-text-editor]').count(), 1);
  assert.equal(await panel.getByRole('button', { name: '启用正文', exact: true }).count(), 0);
  assert.equal(await panel.getByTestId('editor-toolbar').count(), 1);
  assert.equal((await rowBody(identity)).version, 0, 'opening has a logical empty body');
  assert.equal(await panel.getByRole('textbox', { name: title.name, exact: true }).count(), 1);
  // No debounce wait: normal close must flush both independent saves without a decision dialog.
  await panel.getByRole('textbox', { name: title.name, exact: true }).fill('立即关闭也保存标题');
  await body(panel).fill('输入后立即关闭：同一记录的正文。');
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('heading', { name: '仍有内容未保存' }).count(), 0);
  assert.equal((await command('getRow', { rowId: first.id })).cells[title.id], '立即关闭也保存标题');
  assert(JSON.stringify((await rowBody( identity)).content).includes('输入后立即关闭'));
  await page.getByTestId(`open-grid-record-${first.id}`).click(); await body(panel).waitFor();
  assert((await body(panel).innerText()).includes('输入后立即关闭')); assert.equal((await command('getRow', { rowId: first.id })).cells[content.id], '自建内容列保留');
  await pause(200);
  await page.evaluate(async () => {
    window.bodyChanges = [];
    const { subscribeDataChanges } = await import('/src/lib/data-changes.ts');
    window.unsubscribeBodyChanges = subscribeDataChanges(change => window.bodyChanges.push(change));
  });
  await body(panel).fill('仅修改正文也刷新所属记录'); await saved(panel);
  await page.waitForFunction(tableId => window.bodyChanges.some(change => !change.all && change.tableIds.includes(tableId)), table.id);
  await page.evaluate(() => window.unsubscribeBodyChanges());
  // Saving one part does not claim the whole page is saved when the body fails.
  let failBody = true;
  const reject = async route => { const request = route.request(); if (failBody && request.method() === 'POST' && (request.postDataJSON().command === 'updateCells' && !!request.postDataJSON().input.body)) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'REQUEST_FAILED' }) }); else await route.fallback(); };
  await page.route('**/api/commands', reject);
  await panel.getByRole('textbox', { name: title.name, exact: true }).fill('标题已保存正文失败'); await body(panel).fill('网络失败仍保留的正文草稿');
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click();
  const leave = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '仍有内容未保存', exact: true }) }); await leave.waitFor();
  assert.equal((await command('getRow', { rowId: first.id })).cells[title.id], '标题已保存正文失败');
  await leave.getByRole('button', { name: '保留草稿并离开', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  await page.getByTestId(`open-grid-record-${second.id}`).click(); await body(panel).waitFor(); assert.equal((await body(panel).innerText()).trim(), '');
  assert.equal((await rowBody({ rowId: second.id })).version, 0);
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  failBody = false; await page.unroute('**/api/commands', reject);
  await page.getByTestId(`open-grid-record-${first.id}`).click(); await saved(panel);
  assert((await body(panel).innerText()).includes('网络失败仍保留'));
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 1100]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 }); await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme); await pause(150);
    assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: artifact(`unified-record-${width}-${theme}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  // Any ordinary table adds a site as a normal view; no special content table.
  await page.getByTestId('add-view').click(); await page.getByRole('menuitem', { name: '站点视图', exact: true }).click();
  const create = page.getByRole('dialog'); await create.getByRole('textbox', { name: '视图名称', exact: true }).fill('普通表的站点');
  await create.getByRole('combobox', { name: '标题', exact: true }).click(); await page.getByRole('option', { name: '标题', exact: true }).click();
  await create.getByRole('button', { name: '新建站点视图', exact: true }).click(); await create.waitFor({ state: 'hidden' });
  const view = (await command('listViews', { tableId: table.id })).find(view => view.type === 'site'); assert(view);
  await page.getByRole('checkbox', { name: '选择文章：标题已保存正文失败', exact: true }).check();
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '发布站点', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  let detail = await command('getView', { viewId: view.id }); assert(detail.site.publishedRevisionId);
  assert.equal(detail.config.mapping.slug, undefined, 'missing slug uses stable row ID');
  const readPage = async url => (await fetch(url)).text();
  const publishedUrl = `${detail.site.publicUrl}articles/${first.id}.html`;
  const original = await readPage(publishedUrl); assert(original.includes('网络失败仍保留'));
  await command('updateCells', { rowId: first.id, body: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '未发布草稿' }] }] }, expectedVersion: (await rowBody({ rowId: first.id })).version }, idempotencyKey: crypto.randomUUID() });
  assert.equal(await readPage(publishedUrl), original, 'source edits never publish');
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 1100]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme); await pause(150);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: artifact(`unified-site-view-${width}-${theme}.png`), fullPage: false });
  }
  await page.getByRole('button', { name: '撤回记录', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认操作', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  detail = await command('getView', { viewId: view.id }); assert.equal(detail.site.publishedRows.length, 0);
  assert.equal((await fetch(publishedUrl)).status, 404);
  await page.reload(); await page.getByTestId('view-site').click(); await page.getByTestId('blog-editor').waitFor();
  assert.equal(await page.getByRole('tab', { name: '历史', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '预览文章', exact: true }).count(), 0);
  assert.deepEqual(f.errors, []); assert.deepEqual(nativeDialogs, []);
  console.log('PASS unified rows/body/site view: logical empty, autosave+failure draft isolation, ordinary-table view creation, explicit publish/withdraw, stable row IDs, source drafts private, desktop light/dark/narrow.');
} catch (error) { await page.screenshot({ path: artifact('unified-writing-failure.png'), fullPage: false }).catch(() => {}); console.error(f.errors); console.error(await page.locator('body').innerText().catch(() => 'no page')); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
