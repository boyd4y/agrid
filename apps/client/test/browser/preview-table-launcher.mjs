import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';

const f = await createBrowserFixture({ name: '预览表格入口列表' });
const { page, api, ctx, base, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const slot = page.getByTestId('workspace-preview-slot');
const launcher = page.getByTestId('preview-table-launcher');
const header = page.getByTestId('preview-slot-header');
const tableButton = table => launcher.locator(`button[data-table-id="${table.id}"]`);
const toggle = () => page.getByTestId('workspace-preview-toggle').click();
try {
  const workspaces = (await api('/commands', { command: 'listWorkspaces' })).result;
  const original = workspaces[0];
  await page.goto(frontend + '/app');
  await toggle();
  await launcher.getByRole('status').waitFor();
  assert.equal(await launcher.getByRole('status').innerText(), '还没有表格');
  assert.equal(await slot.getByRole('button').count(), 0, 'empty workspace has no disabled menu');

  const emptySite = await api('/sites', { name: '空工作区预览', files: [{ path: 'index.html', content: '<!doctype html><h1>空工作区</h1>' }] });
  await page.evaluate(siteId => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail: { kind: 'site', siteId } })), emptySite.id);
  await slot.locator('[role=tabpanel]:visible').frameLocator('iframe').getByRole('heading', { name: '空工作区', exact: true }).waitFor();
  await header.getByRole('button', { name: '关闭站点 · 空工作区预览 Tab', exact: true }).click();
  await launcher.getByRole('status').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-table-launcher]') === document.activeElement);
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('launcher-empty-zh-CN.png'), animations: 'disabled' });

  const names = ['客户资料', '客户资料备份', '长期项目与跨团队协作记录'.repeat(6), ...Array.from({ length: 12 }, (_, i) => `工作表 ${i + 1}`)];
  const tables = [];
  for (const name of names) tables.push(await api('/tables', { name }));
  // Legacy duplicate names still identify distinct, real resources by ID.
  const duplicateMetadata = async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: base + url.pathname + url.search });
    const rows = await response.json();
    await route.fulfill({ response, json: rows.map(row => row.id === tables[1].id ? { ...row, name: tables[0].name } : row) });
  };
  await page.route('**/api/tables', duplicateMetadata);
  await page.reload(); await toggle();
  await tableButton(tables[0]).waitFor();
  assert.equal(await launcher.getByRole('button').count(), tables.length);
  assert.equal(await tableButton(tables[0]).getAttribute('aria-label'), '客户资料 · 同名表格 1');
  assert.equal(await tableButton(tables[1]).getAttribute('aria-label'), '客户资料 · 同名表格 2');
  for (const table of tables) {
    assert.equal((await tableButton(table).innerText()).includes(table.id), false);
    assert.equal((await tableButton(table).getAttribute('title')).includes(table.id), false);
    assert.equal((await tableButton(table).getAttribute('aria-label')).includes(table.id), false);
  }
  assert.equal(await header.locator('[aria-haspopup=menu]').count(), 0);
  const second = tableButton(tables[1]);
  await tableButton(tables[0]).focus();
  await page.keyboard.press('Tab');
  assert(await second.evaluate(el => el === document.activeElement), 'Tab follows the vertical table order');
  await page.keyboard.press('Enter');
  await slot.getByTestId('preview-slot-table').waitFor();
  assert.match(await header.getByRole('tab').getAttribute('data-state'), /active/);
  await header.getByRole('button', { name: '表格列表', exact: true }).click();
  await launcher.waitFor();
  assert.equal(await header.getByRole('tab').count(), 1);
  await page.evaluate(tableId => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail: { kind: 'table', tableId } })), tables[1].id);
  await launcher.waitFor({ state: 'hidden' });
  assert.equal(await header.getByRole('tab').count(), 1, 'tool opening from launcher reuses the resource key');
  await header.getByRole('button', { name: /关闭.*Tab/ }).click();
  await launcher.waitFor();
  assert.equal(await header.getByRole('tab').count(), 0);
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-table-launcher] button') === document.activeElement);

  for (const locale of ['zh-CN', 'en']) {
    await page.evaluate(locale => localStorage.setItem('tabdo.locale', locale), locale);
    await page.reload(); await toggle();
    await launcher.getByRole('button').first().waitFor();
    const label = locale === 'en' ? 'Table list' : '表格列表';
    assert.equal(await launcher.getAttribute('aria-label'), label);
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await pause(100);
      assert(await launcher.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long names fit the launcher');
      assert(await slot.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'preview fits its panel');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits viewport');
      await launcher.getByRole('button').last().focus();
      assert(await launcher.evaluate(el => el.scrollTop > 0), 'keyboard focus reveals lower tables');
      await launcher.getByRole('button').first().focus();
      if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`launcher-${locale}-${width}-${theme}.png`), animations: 'disabled' });
    }
  }
  await page.unroute('**/api/tables', duplicateMetadata);
  const other = (await api('/commands', { command: 'createWorkspace', input: { name: '入口隔离工作区' } })).result;
  await page.reload();
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: other.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === other.id);
  await toggle();
  await launcher.getByRole('status').waitFor();
  assert.equal(await launcher.getByRole('status').innerText(), 'No tables yet');
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('launcher-empty-en-320.png'), animations: 'disabled' });
  assert.equal(await launcher.getByRole('button').count(), 0, 'workspace switch clears the previous table list');
  const response = await ctx.request.post(base + '/api/tables', { headers: { Origin: frontend, 'X-Workspace-Id': other.id }, data: { name: '当前工作区的表格' } });
  assert(response.ok());
  const local = await response.json();
  await page.reload(); await toggle();
  await tableButton(local).waitFor();
  assert.equal(await launcher.getByRole('button').count(), 1);
  await page.getByTestId('workspace-switcher').click();
  await page.getByRole('menuitem', { name: original.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === original.id);
  await toggle();
  await tableButton(tables[0]).waitFor();
  assert.equal(await launcher.getByRole('button').count(), tables.length);
  assert.deepEqual(f.errors, []);
  console.log('PASS table launcher: empty/multiple/legacy duplicate/long names; keyboard selection and scrolling; tool reuse and close-last; workspace isolation; 1440/390/320 Chinese+English light+dark.');
} finally { await f.close(); }
