import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath } from './fixture.mjs';
import { assertToolbarFits, assertOrdinaryEditorActions } from './helpers/editor-layout.mjs';

const directory = artifactPath('toolbar-fit-files');
const f = await createBrowserFixture({ name: 'Editor layout and title padding', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory } });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(12000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const saved = root => root.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
async function checkSurface(root, titleName, surface) {
  const title = root.getByRole('textbox', { name: titleName, exact: true }), toolbar = root.getByTestId('editor-toolbar');
  await root.getByRole('textbox', { name: '正文内容', exact: true }).waitFor();
  await assertOrdinaryEditorActions(root);
  await title.blur();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.record-title')).borderTopColor === 'rgba(0, 0, 0, 0)');
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
    const layout = await assertToolbarFits(toolbar);
    if (width === 1440) { assert(Math.abs(layout.width - 1000) < 1); assert.equal(new Set(layout.buttons.map(b => b.y)).size, 1); }
    await title.fill('');
    assert(await title.getAttribute('placeholder'), 'empty title retains its placeholder');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.record-title')).borderTopColor !== 'rgba(0, 0, 0, 0)');
    const style = await title.evaluate(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight), top: parseFloat(s.paddingTop), bottom: parseFloat(s.paddingBottom), font: parseFloat(s.fontSize), focused: el === document.activeElement, ring: s.boxShadow, x: r.x, rightEdge: r.right };
    });
    assert(style.left >= 12 && style.right >= 12 && style.top >= 8 && style.bottom >= 8, 'caret/placeholder has space inside focus boundary');
    assert(style.font >= 24 && style.focused && style.ring !== 'none', 'large directly editable title keeps focus ring');
    assert(style.x >= 0 && style.rightEdge <= width + 1);
    await title.fill(theme === 'light' ? '中文标题保留内边距' : 'English title keeps padding');
    await saved(root);
    assert.equal(await title.inputValue(), theme === 'light' ? '中文标题保留内边距' : 'English title keeps padding');
    assert.equal(await root.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await title.focus();
    await page.screenshot({ path: artifact(`${surface}-${width}-${theme}.png`) });
    await toolbar.getByRole('button', { name: '搜索与替换', exact: true }).click();
    const search = page.getByRole('dialog', { name: '搜索与替换', exact: true });
    await search.getByLabel('搜索', { exact: true }).focus(); await page.keyboard.press('Escape');
    await search.waitFor({ state: 'hidden' });
    const refreshed = page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'getRow');
    await toolbar.getByRole('button', { name: '刷新记录', exact: true }).click(); await refreshed;
    await saved(root);
  }
}
try {
  const table = await api('/tables', { name: '布局与标题' }), titleColumn = (await api(`/tables/${table.id}`)).columns[0];
  const row = await api(`/tables/${table.id}/rows`, { cells: { [titleColumn.id]: '默认记录' } });
  await page.goto(frontend + `/app/tables/${table.id}`); await page.getByTestId(`open-grid-record-${row.id}`).click();
  const panel = page.getByTestId('related-record-panel');
  await checkSurface(panel, titleColumn.name, 'fit-record');
  assert.equal((await command('getRow', { rowId: row.id })).cells[titleColumn.id], 'English title keeps padding', 'title autosaves');
  // Export is restricted to recovery from an actual optimistic-concurrency conflict.
  const identity = { tableId: table.id, rowId: row.id }, body = panel.getByRole('textbox', { name: '正文内容', exact: true });
  await body.fill('First saved body'); await saved(panel);
  const current = await command('getDocument', identity);
  await command('replaceDocument', { ...identity, expectedVersion: current.version, idempotencyKey: crypto.randomUUID(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Server body' }] }] } });
  await body.fill('Unsaved conflicting draft'); await panel.getByRole('alert').waitFor();
  const download = page.waitForEvent('download'); await panel.getByRole('button', { name: '导出本地草稿', exact: true }).click(); assert.equal((await download).suggestedFilename(), 'document-draft.json');
  const recoveryDownload = page.waitForEvent('download'); await panel.getByRole('button', { name: '导出草稿并加载服务器内容', exact: true }).click(); await recoveryDownload; await saved(panel);
  assert.equal((await body.innerText()).trim(), 'Server body'); await assertOrdinaryEditorActions(panel);
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(frontend + '/app/sites'); await page.getByRole('button', { name: '创建博客', exact: true }).click();
  const create = page.getByRole('dialog'); await create.getByLabel('博客名称', { exact: true }).fill('编辑布局'); await create.getByRole('button', { name: '创建博客', exact: true }).click();
  await page.getByTestId('blog-editor').waitFor(); await page.getByRole('button', { name: '新建文章', exact: true }).click();
  await checkSurface(page.getByTestId('record-page'), '标题', 'fit-blog');
  assert.deepEqual(f.errors, []);
  console.log('PASS real record/blog default 1000 + viewport 320/390 light/dark: all toolbar actions inside container, no internal scrolling, direct search/refresh, no ordinary export/help; empty/Chinese/English focused title padding and autosave; conflict-only download/reload retained');
} catch (error) { await page.screenshot({ path: artifact('editor-toolbar-fit-failure.png') }).catch(() => {}); console.error(f.errors); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
