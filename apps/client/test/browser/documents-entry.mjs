import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';
const f = await createBrowserFixture({ name: 'Grid document entry' });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
try {
  const table = await api('/tables', { name: '普通文章表' });
  const title = (await api(`/tables/${table.id}`)).columns[0];
  const note = await api(`/tables/${table.id}/columns`, { name: '备注', type: 'text' });
  const rows = [];
  for (const name of ['首行', '目标文章', '另一篇文章']) rows.push(await api(`/tables/${table.id}/rows`, { cells: { [title.id]: name, [note.id]: '原单元格' } }));
  assert((await api(`/tables/${table.id}`)).columns.every(column => column.type !== 'relation'));
  assert((await command('listViews', { tableId: table.id })).every(view => view.type !== 'board'));
  await page.goto(frontend + `/app/tables/${table.id}`);
  const first = page.getByTestId(`open-grid-record-${rows[0].id}`), target = page.getByRole('button', { name: '打开记录：目标文章', exact: true });
  await first.waitFor(); await target.waitFor();
  assert(await target.isVisible(), 'entry is visible without hover');
  // Single-cell editing stays on its existing path and does not open details.
  const cell = page.locator(`[data-cell][data-row-id="${rows[0].id}"][data-col-name="备注"]`);
  await cell.click(); await cell.getByRole('textbox').fill('单元格独立编辑');
  const patched = page.waitForResponse(response => response.url().includes(`/api/rows/${rows[0].id}`) && response.request().method() === 'PATCH' && response.ok());
  await cell.getByRole('textbox').press('Enter'); await patched;
  assert.equal(await page.getByTestId('related-record-panel').count(), 0);
  assert.equal((await command('getRow', { rowId: rows[0].id })).cells[note.id], '单元格独立编辑');
  // Move through the actual Tab order from another row, then activate by keyboard.
  await first.focus(); let reached = false;
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (await target.evaluate(el => el === document.activeElement)) { reached = true; break; } }
  assert(reached, 'second row entry is reachable through Tab');
  await page.keyboard.press('Space');
  const panel = page.getByTestId('related-record-panel'); await panel.getByRole('textbox', { name: '标题', exact: true }).waitFor();

  const modal = page.getByTestId('related-record-panel'), body = modal.getByRole('textbox', { name: '正文内容', exact: true });
  await body.fill('第二行的独立正文，通过普通表格入口撰写。');
  await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  const close = async () => { await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' }); };
  await close();
  await page.getByTestId(`open-grid-record-${rows[2].id}`).click();

  await body.fill('第三行保持自己的正文。'); await modal.getByRole('status').filter({ hasText: '已保存' }).waitFor(); await close();
  await target.click(); await body.waitFor();
  assert.equal(await body.innerText(), '第二行的独立正文，通过普通表格入口撰写。');
  await modal.getByRole('button', { name: '关闭记录', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  // Reopen the same row after its modal record page closes.
  await target.click(); await body.waitFor();
  assert.equal(await body.innerText(), '第二行的独立正文，通过普通表格入口撰写。'); await close();
  await page.reload(); await target.click(); await body.waitFor();
  assert.equal(await body.innerText(), '第二行的独立正文，通过普通表格入口撰写。'); await close();
  assert(JSON.stringify((await command('getDocument', { tableId: table.id, rowId: rows[2].id })).content).includes('第三行保持自己的正文'));
  assert.equal(await command('getDocument', { tableId: table.id, rowId: rows[0].id }), null);
  assert.equal((await command('getRow', { rowId: rows[1].id })).version, 1);
  // Bounded visual matrix also checks the sticky entry after horizontal scrolling.
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    if (width === 390 && theme === 'light') { await page.getByRole('button', { name: '收起侧栏', exact: true }).click(); await page.getByRole('button', { name: '展开侧栏', exact: true }).waitFor(); }
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme); await pause(250);
    if (width === 390) {
      await page.getByTestId('table-scroll').hover(); await page.mouse.wheel(300, 0); await pause(100);
      const bounds = await target.boundingBox(), scroll = await page.getByTestId('table-scroll').boundingBox();
      assert(bounds.x >= scroll.x && bounds.x + bounds.width <= scroll.x + scroll.width, 'row entry remains visible on narrow horizontal scroll');
    }
    await page.screenshot({ path: artifact(`grid-entry-${width}-${theme}.png`), fullPage: false });
    await target.click(); await panel.getByRole('textbox', { name: '标题', exact: true }).waitFor();
    await body.waitFor();
    assert.equal(await body.innerText(), '第二行的独立正文，通过普通表格入口撰写。'); await close();
  }
  const extra = await command('batchAddRows', { tableId: table.id, rows: Array.from({ length: 100 }, (_, index) => ({ cells: { [title.id]: `虚拟记录 ${index}`, [note.id]: '滚动加载' } })) });
  await page.reload(); await page.getByTestId('table-scroll').waitFor();
  await page.getByTestId('table-scroll').hover(); await page.mouse.wheel(0, 7000);
  const last = page.getByTestId(`open-grid-record-${extra.rowIds.at(-1)}`); await last.waitFor();
  assert(await page.locator('[data-testid^="open-grid-record-"]').count() < 103, 'row actions remain virtualized');
  await last.click(); await panel.getByRole('textbox', { name: '标题', exact: true }).waitFor();
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click();
  await page.getByTestId('table-scroll').hover(); await page.mouse.wheel(0, -7000); await first.waitFor();
  assert.deepEqual(f.errors, []);
  console.log('PASS grid entry: ordinary fields/no relations/no board, visible per-row action, real Tab/Space and clicks, cell editing, independent rows, autosave/reopen/refresh, narrow horizontal scroll, light/dark and virtualized row remounts.');
} catch (error) { await page.screenshot({ path: artifact('grid-entry-failure.png'), fullPage: false }).catch(() => {}); throw error; }
finally { await f.close(); }
