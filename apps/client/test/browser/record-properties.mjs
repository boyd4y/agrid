import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createBrowserFixture, artifact as artifactPath } from './fixture.mjs';
const directory = artifactPath('record-properties-files');
const f = await createBrowserFixture({ name: 'Document-like record properties', serverEnv: { FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_LOCAL_DIR: directory } });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(12000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const panel = page.getByTestId('related-record-panel');
const field = id => panel.locator(`[data-record-field="${id}"]`);
const body = panel.getByRole('textbox', { name: '正文内容', exact: true });
const saved = () => panel.getByRole('status').filter({ hasText: '全部更改已保存' }).waitFor();
const open = async (table, row) => { await page.goto(frontend + `/app/tables/${table.id}`); await page.getByTestId(`open-grid-record-${row.id}`).click(); await body.waitFor(); };
const close = async () => { await panel.getByRole('button', { name: '关闭记录', exact: true }).click(); await panel.waitFor({ state: 'hidden' }); };
try {
  for (const count of [0, 1, 3]) {
    const table = await api('/tables', { name: `属性数量 ${count}` });
    const title = (await api(`/tables/${table.id}`)).columns[0];
    for (let i = 0; i < count; i++) await command('addColumn', { tableId: table.id, name: `属性${i}`, type: 'text' });
    const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: `记录${count}` } });
    await open(table, row);
    assert.equal(await panel.locator('.record-property:visible').count(), count);
    assert.equal(await panel.getByRole('button', { name: /显示全部属性|收起属性/ }).count(), 0);
    await close();
  }
  const table = await api('/tables', { name: '十项属性折叠' });
  const title = (await api(`/tables/${table.id}`)).columns[0], columns = [];
  for (const [name, type, config] of [
    ['姓名', 'text', {}], ['数值', 'number', {}], ['完成', 'checkbox', {}],
    ['额外文字', 'text', {}], ['选择', 'select', { options: [{ id: 'one', label: '第一项', color: '#337ea9' }] }],
    ['多选', 'multi_select', { options: [{ id: 'two', label: '第二项', color: '#448361' }] }],
    ['日期', 'date', {}], ['成员', 'person', {}], ['附件', 'file', { file: { multiple: true } }], ['公式', 'formula', { formula: '1 + 1' }],
  ]) columns.push(await command('addColumn', { tableId: table.id, name, type, config }));
  const hidden = await command('addColumn', { tableId: table.id, name: '隐藏', type: 'text', config: { hidden: true } });
  const row = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '默认显示前三项', [hidden.id]: '不可见值' } });
  const second = await api(`/tables/${table.id}/rows`, { cells: { [title.id]: '另一记录' } });
  await open(table, row);
  assert.equal(await panel.locator('.record-property:visible').count(), 3);
  assert.equal(await field(hidden.id).count(), 0);
  const checkbox = field(columns[2].id).getByRole('checkbox');
  const checkboxStyle = () => checkbox.evaluate(el => { const s = getComputedStyle(el); return { border: s.borderTopColor, background: s.backgroundColor, ring: s.boxShadow }; });
  const unchecked = await checkboxStyle(); assert.notEqual(unchecked.border, 'rgba(0, 0, 0, 0)', 'unchecked checkbox keeps its border');
  await saved();
  // Returned record columns can put another input between number and checkbox.
  // Start at the actual preceding control, then test native Tab navigation.
  const propertyControls = panel.locator('[data-slot="field-group"] :is(input, button):visible:not(:disabled):not([tabindex="-1"])');
  const checkboxIndex = await propertyControls.evaluateAll(nodes => nodes.findIndex(node => node.getAttribute('role') === 'checkbox'));
  assert(checkboxIndex > 0, 'checkbox has a preceding focusable property control');
  const predecessor = propertyControls.nth(checkboxIndex - 1);
  await predecessor.focus();
  assert(await predecessor.evaluate(el => el === document.activeElement), 'Tab starts from the preceding property control');
  await page.keyboard.press('Tab');
  assert(await checkbox.evaluate(el => el === document.activeElement)); assert.notEqual((await checkboxStyle()).ring, 'none', 'checkbox keeps its focus ring');
  let releaseRow, rowStarted;
  const heldRow = new Promise(resolve => { releaseRow = resolve; }), startedRow = new Promise(resolve => { rowStarted = resolve; });
  const rowRoute = async route => { rowStarted(); await heldRow; await route.fallback(); };
  await page.route(`**/api/rows/${row.id}`, rowRoute);
  await checkbox.check(); const checked = await checkboxStyle(); assert.notEqual(checked.background, unchecked.background, 'checked background remains visible');
  await startedRow;
  assert(await checkbox.evaluate(el => !!el.closest('[inert]')), 'checkbox cannot edit while saving');
  assert.equal(await field(columns[2].id).getAttribute('data-disabled'), 'true');
  assert.equal(await field(columns[2].id).locator('[data-slot="field-label"]').evaluate(el => getComputedStyle(el).opacity), '0.5', 'saving retains disabled label feedback');
  releaseRow(); await saved(); await page.unroute(`**/api/rows/${row.id}`, rowRoute);
  assert(await checkbox.isChecked()); assert.equal((await checkboxStyle()).background, checked.background);
  const toggle = panel.getByRole('button', { name: '显示全部属性（另外 7 项）', exact: true }); await toggle.click();
  assert.equal(await panel.locator('.record-property:visible').count(), 10);
  await body.focus();
  await page.screenshot({ path: artifact('properties-expanded-desktop-light.png') });
  const extra = field(columns[3].id).getByRole('textbox'); await extra.fill('折叠也保留');
  await field(columns[4].id).getByRole('button').click(); await page.getByRole('button', { name: '第一项', exact: true }).click();
  await field(columns[5].id).getByRole('button').click(); await page.getByRole('button', { name: '第二项', exact: true }).click(); await page.keyboard.press('Escape');
  await field(columns[6].id).getByRole('button').first().click(); await page.keyboard.press('Escape');
  await field(columns[7].id).getByRole('button').click(); await page.getByRole('button', { name: 'Document-like record properties', exact: true }).click();
  assert.equal(await field(columns[9].id).getByRole('textbox').count(), 0, 'formula remains read only');
  // Hold the actual multipart request while collapsing and closing the record.
  let releaseUpload, uploadStarted;
  const held = new Promise(resolve => { releaseUpload = resolve; }), started = new Promise(resolve => { uploadStarted = resolve; });
  await page.route(`**/api/tables/${table.id}/columns/${columns[8].id}/files`, async route => { uploadStarted(); await held; await route.fallback(); });
  await field(columns[8].id).locator('input[type="file"]').setInputFiles({ name: 'retained.txt', mimeType: 'text/plain', buffer: Buffer.from('upload while folded') });
  await started;
  await panel.getByRole('button', { name: '收起属性', exact: true }).click();
  assert.equal(await panel.locator('.record-property:visible').count(), 3);
  // The value and the exact DOM node survive both visibility changes.
  await toggle.click(); assert.equal(await extra.inputValue(), '折叠也保留');
  await panel.getByRole('button', { name: '收起属性', exact: true }).click();
  await panel.getByRole('button', { name: '关闭记录', exact: true }).click();
  assert(await panel.isVisible(), 'close waits for the hidden upload');
  releaseUpload(); await panel.waitFor({ state: 'hidden' });
  const result = await command('getRow', { rowId: row.id });
  assert.equal(result.cells[columns[2].id], true); assert.equal(result.cells[columns[3].id], '折叠也保留'); assert.equal(result.cells[columns[4].id], 'one'); assert.deepEqual(result.cells[columns[5].id], ['two']);
  assert.equal(result.cells[columns[7].id], f.users[0]); assert.equal(result.cells[columns[8].id].length, 1); assert.equal(result.cells[hidden.id], '不可见值');
  await open(table, second); assert.equal(await panel.locator('.record-property:visible').count(), 3); await toggle.click(); assert.equal(await extra.inputValue(), ''); await close();
  await open(table, row); assert.equal(await panel.locator('.record-property:visible').count(), 3);
  await toggle.click(); assert.equal(await extra.inputValue(), '折叠也保留'); await field(columns[8].id).getByText('retained.txt', { exact: true }).waitFor();
  // Local property failure survives folding; closing offers the existing draft protection.
  await field(columns[1].id).getByRole('textbox').fill('invalid'); await panel.getByRole('alert').waitFor();
  const invalid = field(columns[1].id).getByRole('textbox');
  const checkErrorBorder = async state => {
    const colors = await invalid.evaluate(el => { const style = getComputedStyle(el), probe = document.createElement('span'); probe.style.color = 'var(--destructive)'; el.parentElement.append(probe); const expected = getComputedStyle(probe).color; probe.remove(); return { border: style.borderTopColor, expected }; });
    assert.equal(colors.border, colors.expected, `invalid border stays visible: ${state}`);
  };
  await invalid.blur(); await page.mouse.move(0, 0); await checkErrorBorder('default');
  await invalid.hover(); await checkErrorBorder('hover'); await invalid.focus(); await checkErrorBorder('focus');
  await panel.getByRole('button', { name: '收起属性', exact: true }).click(); await panel.getByRole('button', { name: '关闭记录', exact: true }).click();
  await page.getByRole('heading', { name: '仍有内容未保存', exact: true }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).first().click(); assert.equal(await field(columns[1].id).getByRole('textbox').inputValue(), 'invalid');
  await field(columns[1].id).getByRole('textbox').fill('42'); await panel.getByRole('button', { name: '重试保存', exact: true }).click(); await saved();
  // Long body and expanded properties share one scroll owner; toolbar remains sticky.
  await body.fill(Array.from({ length: 60 }, (_, i) => `长正文 ${i}`).join('\n')); await saved();
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.evaluate(value => document.documentElement.classList.toggle('dark', value === 'dark'), theme); await page.waitForTimeout(200);
    await panel.locator('[data-testid="record-page"]').evaluate(el => { el.parentElement.scrollTop = 0; });
    await page.screenshot({ path: artifact(`properties-top-${width}-${theme}.png`) });
    assert(await checkbox.isChecked()); assert.notEqual((await checkboxStyle()).background, 'rgba(0, 0, 0, 0)');
    await panel.locator('[data-testid="record-page"]').evaluate(el => { el.parentElement.scrollTop = 1000; });
    const layout = await panel.evaluate(el => { const scroller = el.querySelector('[data-testid="record-page"]').parentElement, toolbar = el.querySelector('[data-testid="editor-toolbar"]'); return { top: toolbar.getBoundingClientRect().top, scrollTop: scroller.getBoundingClientRect().top, overflow: el.scrollWidth > el.clientWidth + 1, scrollOwners: [...el.querySelectorAll('*')].filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length }; });
    assert.equal(layout.overflow, false); assert.equal(layout.scrollOwners, 1); assert(Math.abs(layout.top - layout.scrollTop) < 2, 'toolbar stays at the common scroll boundary');
    await page.screenshot({ path: artifact(`properties-${width}-${theme}.png`) });
  }
  await close(); assert.deepEqual(f.errors, []);
  console.log('PASS 0/1/3/10 properties; count/order/hidden; direct text/checkbox/select/multiselect/date/person/formula; checkbox unchecked/checked/focus/saving states; collapse preserves live upload and close flush; record isolation; invalid draft protection/retry; long-body sticky single scroller; 1440/390/320 light/dark');
} catch (error) { await page.screenshot({ path: artifact('record-properties-failure.png') }).catch(() => {}); throw error; }
finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
