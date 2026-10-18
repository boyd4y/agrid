import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';
const f = await createBrowserFixture({ name: '三类入口键盘与资源选择' });
const { page, api, ctx, base, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const slot = page.getByTestId('workspace-preview-slot'), launcher = slot.getByTestId('preview-launcher'), header = slot.getByTestId('preview-slot-header');
const picker = () => header.getByTestId('preview-resource-picker');
const shortcut = number => page.keyboard.press(`Control+Shift+Digit${number}`);
const home = () => header.getByRole('button', { name: /预览首页|Preview home/, exact: true }).click();
try {
  const agent = (await api('/members/agents', { name: '键盘测试助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; f.users.push(agent.userId);
  await page.goto(frontend + '/app');
  await page.getByTestId('workspace-preview-toggle').click();
  assert.equal(await launcher.getByRole('button').count(), 3);
  for (let index = 0; index < 3; index++) {
    const button = launcher.getByRole('button').nth(index);
    assert.equal(await button.getAttribute('aria-keyshortcuts'), `Control+Shift+${index + 1}`);
  }
  for (const [index, empty] of ['还没有表格', '还没有站点', '还没有报告'].entries()) {
    await launcher.getByRole('button').nth(index).focus(); await page.keyboard.press('Enter');
    await picker().click(); await page.locator('[cmdk-list]').getByText(empty, { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await home();
  }
  // Actual keydown uses event.code; with Shift the browser's key is !/@/#.
  await page.getByTestId('workspace-preview-toggle').click();
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (let n = 1; n <= 3; n++) { await shortcut(n); await header.getByRole('tab', { name: ['表格', '站点', '报告'][n - 1], exact: true, selected: true }).waitFor(); }
  assert.equal(await page.getByTestId('workspace-home-split').getAttribute('data-preview-open'), 'true');
  assert.equal(await header.getByRole('tab').count(), 3);
  // Inputs, editable roots, IME, repeats and portals must not steal the shortcut.
  await picker().click(); const search = page.getByRole('combobox', { name: '搜索资源…' });
  await search.focus(); await shortcut(1);
  assert.equal(await header.getByRole('tab', { selected: true }).getAttribute('aria-label'), '报告');
  await page.keyboard.press('Escape');
  const composer = page.getByTestId('workspace-home-split').locator('textarea').first();
  await composer.focus(); await shortcut(1);
  assert.equal(await header.getByRole('tab', { selected: true }).getAttribute('aria-label'), '报告');
  await page.evaluate(() => {
    document.activeElement?.blur();
    for (const init of [{ isComposing: true }, { repeat: true }, { keyCode: 229 }]) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true, ...init }));
    for (const selector of ['div[contenteditable=true]', 'div.cm-editor', 'div.tiptap']) {
      const node = document.createElement('div'); node.tabIndex = 0;
      if (selector.includes('contenteditable')) node.contentEditable = 'true'; else node.className = selector.split('.')[1];
      document.body.append(node); node.focus(); node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true })); node.remove();
    }
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.append(modal);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', ctrlKey: true, shiftKey: true })); modal.remove();
  });
  assert.equal(await header.getByRole('tab', { selected: true }).getAttribute('aria-label'), '报告');
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await shortcut(1); await header.getByRole('tab', { name: '表格', selected: true, exact: true }).waitFor();
  await page.keyboard.press('Meta+Shift+Digit3');
  assert.equal(await header.getByRole('tab', { selected: true }).getAttribute('aria-label'), '表格');
  const tables = [];
  for (const name of ['客户资料', '第二表格', '长名'.repeat(45), ...Array.from({ length: 12 }, (_, i) => `工作表 ${i + 1}`)]) tables.push(await api('/tables', { name }));
  // Refresh metadata and verify a secondary searchable selector, never a home table catalog.
  await page.reload(); await page.getByTestId('workspace-preview-toggle').click();
  assert.equal(await launcher.getByRole('button').count(), 3);
  await launcher.getByRole('button').first().click(); await picker().click();
  await page.getByRole('combobox', { name: '搜索资源…', exact: true }).fill('第二');
  assert.equal(await page.locator('[data-resource-id]').count(), 1);
  await page.keyboard.press('Enter');
  await page.getByTestId('preview-slot-table').waitFor();
  assert.equal(await picker().getAttribute('title'), '第二表格');
  await picker().click(); await page.getByRole('combobox', { name: '搜索资源…', exact: true }).fill('没有这个名字'); await page.getByText('没有匹配的资源', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  // Remote list failures recover in place.
  for (const [kind, url] of [['site', '**/api/sites'], ['report', '**/api/reports?*']]) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const failure = async route => { await gate; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '列表读取失败' }) }); };
    await page.route(url, failure);
    await page.evaluate(kind => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail: { kind } })), kind);
    await header.getByRole('tab', { name: kind === 'site' ? '站点' : '报告', exact: true, selected: true }).waitFor();
    await picker().click(); await page.locator('[cmdk-list]').getByRole('status').waitFor(); release();
    await page.locator('[cmdk-list]').getByRole('alert').waitFor();
    await page.unroute(url, failure); await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText(kind === 'site' ? '还没有站点' : '还没有报告', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  }
  const reports = [];
  for (let n = 0; n < 101; n++) reports.push(await api('/reports', { name: n === 0 ? '仅在第二页的报告' : `分页报告 ${n}`, columns: 1, widgets: [] }));
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await shortcut(1); await header.getByRole('tab', { name: '表格', selected: true, exact: true }).waitFor();
  await shortcut(3); await header.getByRole('tab', { name: '报告', selected: true, exact: true }).waitFor();
  await picker().click(); await page.locator(`[data-resource-id="${reports[0].id}"]`).waitFor();
  await page.getByRole('combobox', { name: '搜索资源…', exact: true }).fill('仅在第二页的报告');
  assert.equal(await page.locator('[data-resource-id]').count(), 1, 'secondary search includes reports beyond page 1');
  await page.keyboard.press('Enter'); await slot.getByTestId('preview-slot-report').waitFor();
  for (const locale of ['zh-CN', 'en']) {
    await page.evaluate(locale => localStorage.setItem('tabdo.locale', locale), locale); await page.reload(); await page.getByTestId('workspace-preview-toggle').click();
    for (const width of [1440, 1024]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme }); await pause(150);
      assert(await launcher.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert(await launcher.evaluate(el => { const bounds = el.getBoundingClientRect(), content = el.firstElementChild.getBoundingClientRect(); return Math.abs((bounds.x + bounds.width / 2) - (content.x + content.width / 2)) < 2 && Math.abs((bounds.y + bounds.height / 2) - (content.y + content.height / 2)) < 2; }), 'entries centered in both axes');
      if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-launcher-${locale}-${width}-${theme}.png`), animations: 'disabled' });
    }
  }
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => sessionStorage.getItem('preview-test-platform') ?? 'MacIntel', configurable: true }));
  for (const platform of ['MacIntel', 'Win32', 'Linux x86_64']) {
    await page.evaluate(platform => sessionStorage.setItem('preview-test-platform', platform), platform);
    await page.reload(); await page.getByTestId('workspace-preview-toggle').click();
    assert.equal(await launcher.locator('kbd').first().innerText(), platform === 'MacIntel' ? '⌃⇧1' : 'Ctrl+Shift+1');
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await shortcut(3); await header.getByRole('tab', { name: 'Reports', exact: true, selected: true }).waitFor();
  }
  const other = (await api('/commands', { command: 'createWorkspace', input: { name: '独立空工作区' } })).result;
  await page.reload(); await page.getByTestId('workspace-home-split').waitFor();
  await page.getByTestId('workspace-switcher').click(); await page.getByRole('menuitem', { name: other.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === other.id);
  await page.getByTestId('workspace-home-split').waitFor(); await page.locator('body').click({ position: { x: 2, y: 2 } }); await shortcut(1); await picker().click();
  await page.locator('[cmdk-list]').getByText('No tables yet', { exact: true }).waitFor(); assert.equal(await page.locator('[data-resource-id]').count(), 0);
  await page.keyboard.press('Escape');
  // Scope also stays attached when opening resources in the switched workspace.
  const response = await ctx.request.post(base + '/api/tables', { headers: { Origin: frontend, 'X-Workspace-Id': other.id }, data: { name: '当前工作区表格' } }); assert(response.ok()); const local = await response.json();
  await page.reload(); await page.getByTestId('workspace-home-split').waitFor(); await page.locator('body').click({ position: { x: 2, y: 2 } }); await shortcut(1); await picker().click(); await page.locator(`[data-resource-id="${local.id}"]`).waitFor(); assert.equal(await page.locator('[data-resource-id]').count(), 1);
  await page.keyboard.press('Escape');
  await page.goto(frontend + '/app/tables?workspace=' + other.id); await page.getByTestId('app-sidebar').waitFor(); await shortcut(2); assert.equal(await page.getByTestId('workspace-preview-slot').count(), 0, 'only conversation page registers shortcuts');
  assert.deepEqual(f.errors, []);
  console.log('PASS centered three entries; actual Control+Shift digits; edit/IME/repeat/modal guards; keyboard selection/search; list error/retry; workspace/page isolation; both languages/themes/desktop.');
} finally { await f.close(); }
