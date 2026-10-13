import assert from 'node:assert/strict';
import { createBrowserFixture, frontend } from './fixture.mjs';

assert((await fetch(frontend, { signal: AbortSignal.timeout(5000) })).ok, 'Use the existing frontend; never restart it');
const fixture = await createBrowserFixture({ name: 'Automation runs sheet browser' });
const { page, api, errors } = fixture;
try {
  const table = await api('/tables', { name: 'Runs sheet source' });
  const column = await api(`/tables/${table.id}/columns`, { name: 'Title', type: 'text' });
  const rule = await api(`/tables/${table.id}/automations`, { name: 'Disabled sheet rule', enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'update_field', columnId: column.id, value: 'local-only' }] });
  let requests = 0, rejectRuns = false;
  await page.route(`**/api/tables/${table.id}/automation-runs?**`, async route => {
    requests++;
    const query = new URL(route.request().url()).searchParams;
    assert.equal(query.get('automationId'), rule.id); assert.equal(query.get('limit'), '30');
    if (rejectRuns) await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture run history unavailable' }) });
    else await route.fallback();
  });
  await page.goto(`${frontend}/app/automations/${rule.id}`);
  const editor = page.getByTestId('automation-editor');
  await editor.waitFor();
  const name = editor.getByPlaceholder('自动化名称');
  assert.equal(await name.inputValue(), rule.name);
  assert.equal(await editor.getByRole('switch', { name: '启用', exact: true }).isChecked(), false);
  await name.fill('Preserved sheet draft');
  const formBefore = await editor.boundingBox();
  const trigger = page.getByRole('button', { name: '运行记录', exact: true });
  const sheet = page.getByTestId('automation-runs-sheet');
  const empty = sheet.getByText('还没有运行记录。', { exact: true });
  const settled = () => page.waitForFunction(() => {
    const node = document.querySelector('[data-testid=automation-runs-sheet]');
    return node && Math.abs(node.getBoundingClientRect().right - innerWidth) < 1;
  });
  const open = async () => { await trigger.click(); await empty.waitFor(); await settled(); };
  assert.equal(requests, 0, 'closed history does not fetch runs');
  await open();
  assert.equal(await sheet.getByRole('heading', { name: '运行记录', exact: true }).count(), 1);
  const desktop = await sheet.boundingBox(); assert.equal(desktop.width, 480); assert.equal(desktop.x + desktop.width, 1600);
  assert.equal((await editor.boundingBox()).y, formBefore.y, 'portal sheet does not move the editing form');
  await page.waitForTimeout(5200); assert(requests >= 2, 'open history polls after five seconds');
  await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
  const closedRequests = requests;
  await page.waitForTimeout(5500); assert.equal(requests, closedRequests, 'closing history stops the five-second poll');
  assert.equal(await name.inputValue(), 'Preserved sheet draft');
  await open();
  await page.locator('[data-slot=sheet-overlay]').click({ position: { x: 20, y: 200 } });
  await sheet.waitFor({ state: 'detached' });
  assert.equal((await editor.boundingBox()).y, formBefore.y);

  rejectRuns = true;
  await trigger.click();
  await sheet.getByRole('alert').getByText('Fixture run history unavailable', { exact: true }).waitFor();
  assert.equal(await editor.getByRole('alert').count(), 0, 'history failure stays inside the sheet');
  assert.equal(await page.getByRole('alert').count(), 1);
  rejectRuns = false;
  await sheet.getByRole('button', { name: '重新加载', exact: true }).click();
  await empty.waitFor(); assert.equal(await sheet.getByRole('alert').count(), 0);
  await sheet.getByRole('button', { name: '关闭', exact: true }).click(); await sheet.waitFor({ state: 'detached' });
  assert.equal(await name.inputValue(), 'Preserved sheet draft', 'error/retry and closing preserve the edit draft');

  for (const width of [700, 320]) {
    // Open before reducing the viewport so this checks the Sheet independent of sidebar width.
    await open(); await page.setViewportSize({ width, height: 650 }); await settled();
    const bounds = await sheet.boundingBox(); assert.equal(bounds.width, Math.min(480, width));
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 650);
    const close = sheet.getByRole('button', { name: '关闭', exact: true });
    const closeBounds = await close.boundingBox(); assert(closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= width);
    await close.click(); await sheet.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1600, height: 1000 });
    assert.equal(await name.inputValue(), 'Preserved sheet draft');
  }
  const persisted = await api(`/automations/${rule.id}`);
  assert.equal(persisted.name, rule.name); assert.equal(persisted.enabled, false, 'no draft or run was implicitly saved');
  assert.deepEqual(errors, []);
  console.log('PASS automation runs Sheet: right 480px/empty, unchanged form position, open polling/closed polling stop, Esc/overlay/reopen, scoped 400/retry/draft retention, 700/320 bounds/close; no screenshots/model calls');
} finally { await fixture.close(); }
