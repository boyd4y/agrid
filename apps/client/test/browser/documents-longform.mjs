import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Long document reading' });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
page.on('dialog', dialog => dialog.accept());
const command = async (command, input) => (await api('/commands', { command, input })).result;
const rowBody = async input => (await command('getRow', { rowId: input.rowId, includeBody: true, bodyFormat: 'html' })).body;
const saveBody = async input => { const result = await command('updateCells', { rowId: input.rowId, body: { content: input.content, expectedVersion: input.expectedVersion ?? 0 }, idempotencyKey: input.idempotencyKey }); return { version: result.bodyVersion }; };

try {
  const table = await api('/tables', { name: '长文验收' });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '按需长文' } });
  const identity = { tableId: table.id, rowId: row.id };
  const open = async (label = '正文') => {
    await page.getByTestId('global-ai-toggle').waitFor();
    await page.getByTestId(`open-grid-record-${row.id}`).click();
    await page.getByTestId('document-editor').waitFor();
  };
  await page.goto(frontend + `/app/tables/${table.id}`); await open();
  const modal = page.getByTestId('related-record-panel');
  const body = modal.getByRole('textbox', { name: '正文内容', exact: true });
  const text = '长文内容应按需保存，不进入表格列表。'.repeat(800);
  await body.fill(text); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.press('Enter');
  await page.keyboard.insertText('长文结束标记 LONGFORM_END');
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  const saved = await rowBody( identity);
  const bytes = new TextEncoder().encode(JSON.stringify(saved.content)).length;
  assert(bytes > 32000 && bytes < 65536, `actual saved JSON bytes: ${bytes}`);
  assert(JSON.stringify(saved.content).includes(text));
  assert(JSON.stringify(saved.content).includes('LONGFORM_END'));
  assert.equal(await modal.getByRole('button', { name: '阅读', exact: true }).count(), 0);
  assert.equal(await body.getAttribute('contenteditable'), 'true');
  await body.locator('p').last().scrollIntoViewIfNeeded();
  assert(await body.getByText('长文结束标记 LONGFORM_END', { exact: true }).isVisible());
  await page.screenshot({ path: f.artifact('longform-read-bottom.png'), fullPage: false });
  const rows = await command('queryRows', { tableId: table.id });
  assert(!JSON.stringify(rows).includes('LONGFORM_END'));
  const metadata = await command('getRow', { rowId: row.id });
  assert.equal(metadata.version, 1); assert.deepEqual(metadata.cells, { [title.id]: '按需长文' });
  await page.evaluate(() => localStorage.setItem('tabdo.locale', 'en')); await page.reload(); await open('Body');
  const englishBody = modal.getByRole('textbox', { name: 'Document body', exact: true });
  await englishBody.waitFor(); assert((await englishBody.innerText()).includes('LONGFORM_END'));
  assert.equal((await rowBody( identity)).version, saved.version);
  assert.equal(await modal.getByRole('button', { name: 'Read', exact: true }).count(), 0);
  assert.equal(await englishBody.getAttribute('contenteditable'), 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await englishBody.locator('p').last().scrollIntoViewIfNeeded();
  assert.equal(await modal.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
  await page.screenshot({ path: f.artifact('longform-read-english-mobile-dark.png'), fullPage: false });
  assert.deepEqual(f.errors, []);
  console.log(`PASS longform: ${bytes} UTF-8 JSON bytes saved through the visual editor; direct-edit scrolling, refresh, independent row version, no body in row queries, English/390px/dark.`);
} catch (error) {
  await page.screenshot({ path: f.artifact('longform-failure.png'), fullPage: false }).catch(() => {});
  throw error;
} finally { await f.close(); }
