import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';
const f = await createBrowserFixture({ name: '居中两步资源与分页' });
const { page, api, ctx, base, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const slot = page.getByTestId('workspace-preview-slot'), launcher = slot.getByTestId('preview-launcher'), header = slot.getByTestId('preview-slot-header');
const step = slot.getByTestId('preview-resource-step');
const picker = () => header.getByTestId('preview-resource-picker');
const shortcut = number => page.keyboard.press(`Control+Shift+Digit${number}`);
const home = () => header.getByRole('button', { name: /预览首页|Preview home/, exact: true }).click();
const search = () => page.getByRole('combobox', { name: /搜索资源…|Search resources…/, exact: true });
const next = () => page.getByRole('button', { name: /下一页|Next page/, exact: true });
const previous = () => page.getByRole('button', { name: /上一页|Previous page/, exact: true });
const assertStepFits = async () => {
  assert(await step.evaluate(el => { const r = el.getBoundingClientRect(), c = el.firstElementChild.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth + 1 && Math.abs(r.x + r.width / 2 - c.x - c.width / 2) < 2 && Math.abs(r.y + r.height / 2 - c.y - c.height / 2) < 2; }), 'secondary step stays centered and fits');
  assert(await step.getByTestId('preview-resource-list').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  assert((await step.locator('[data-resource-id]').count()) <= 10);
  assert(await step.getByTestId('preview-resource-list').evaluate(el => getComputedStyle(el.parentElement).borderTopWidth === '1px'), 'search/list has a single visible surface boundary');
  assert.equal(await picker().count(), 0, 'no header picker before selecting');
};
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
    await step.getByText(empty, { exact: true }).waitFor();
    assert(await search().evaluate(el => el === document.activeElement));
    assert.equal(await header.getByRole('tab').count(), 0, 'empty type tabs never created');
    await assertStepFits();
    await page.keyboard.press('Escape');
    assert(await launcher.getByRole('button').nth(index).evaluate(el => el === document.activeElement), 'Escape restores originating action focus');
  }
  // Control+Shift digits enter the same centered step, even from collapsed preview.
  await page.getByTestId('workspace-preview-toggle').click();
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (let n = 1; n <= 3; n++) {
    await shortcut(n); await step.waitFor(); await search().waitFor();
    assert(await search().evaluate(el => el === document.activeElement));
    assert.equal(await header.getByRole('tab').count(), 0);
    // Inputs, editable roots, IME, repeats and portals must not steal shortcuts.
    await search().focus(); await shortcut(n === 1 ? 2 : 1);
    assert.equal(await step.getByRole('heading').innerText(), ['选择表格', '选择站点', '选择报告'][n - 1]);
    await page.keyboard.press('Escape');
  }
  assert.equal(await page.getByTestId('workspace-home-split').getAttribute('data-preview-open'), 'true');
  const composer = page.getByTestId('workspace-home-split').locator('textarea').first();
  await composer.focus(); await shortcut(1); assert.equal(await step.count(), 0);
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
  assert.equal(await step.count(), 0);
  await page.keyboard.press('Meta+Shift+Digit3'); assert.equal(await step.count(), 0);
  const tables = [];
  for (const name of ['客户资料', '第二表格', '长名'.repeat(45), ...Array.from({ length: 20 }, (_, i) => `工作表 ${i + 1}`)]) tables.push(await api('/tables', { name }));
  await page.reload(); await page.getByTestId('workspace-preview-toggle').click();
  await launcher.getByRole('button').first().click();
  await step.locator('[data-resource-id]').first().waitFor();
  assert.equal(await step.locator('[data-resource-id]').count(), 10);
  assert(await previous().isDisabled());
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('preview-step-tables-default.png'), animations: 'disabled' });
  await search().focus(); await page.keyboard.press('Tab');
  assert(await next().evaluate(el => el === document.activeElement), 'Tab reaches the next-page control');
  await page.keyboard.press('Enter'); await page.getByText('第 2 页，共 3 页', { exact: true }).waitFor();
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('preview-step-tables-page-2.png'), animations: 'disabled' });
  await next().click(); await page.getByText('第 3 页，共 3 页', { exact: true }).waitFor();
  assert.equal(await step.locator('[data-resource-id]').count(), 3); assert(await next().isDisabled());
  const lastTable = await step.locator('[data-resource-id]').last().getAttribute('data-resource-id');
  const lastName = tables.find(item => item.id === lastTable).name;
  await search().fill(lastName); await page.getByText('第 1 页，共 1 页', { exact: true }).waitFor();
  assert.equal(await step.locator('[data-resource-id]').count(), 1, 'search includes last-page table');
  await search().fill(''); await page.getByText('第 1 页，共 3 页', { exact: true }).waitFor();
  await search().fill('第二'); await page.keyboard.press('Enter');
  await slot.getByTestId('preview-slot-table').waitFor(); assert.equal(await picker().getAttribute('title'), '第二表格');
  await home(); await launcher.getByRole('button').first().click(); await step.waitFor();
  assert.equal(await header.getByRole('tab').count(), 1); await page.keyboard.press('Escape');
  await header.getByRole('tab', { name: '表格', exact: true }).click();
  await slot.getByTestId('preview-slot-table').waitFor(); assert.equal(await step.count(), 0);
  await picker().click(); await search().fill('没有这个名字'); await page.getByText('没有匹配的资源', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-resource-picker]') === document.activeElement);
  await picker().click(); await page.locator('[data-resource-id]').first().waitFor();
  await next().click(); await page.getByText('第 2 页，共 3 页', { exact: true }).waitFor();
  await search().fill(lastName); await page.getByText('第 1 页，共 1 页', { exact: true }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForFunction(name => document.querySelector('[data-testid=preview-resource-picker]')?.getAttribute('title') === name, lastName);
  // Failures and delayed reads stay centered and retry in place for all three types.
  for (const [index, url] of [[0, '**/api/tables'], [1, '**/api/sites'], [2, '**/api/reports?*']]) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const failure = async route => { await gate; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '列表读取失败' }) }); };
    await page.route(url, failure); await home(); await launcher.getByRole('button').nth(index).click();
    await step.getByRole('status').waitFor(); release(); await step.getByRole('alert').waitFor();
    await page.unroute(url, failure); await step.getByRole('button', { name: '重试', exact: true }).click();
    if (index === 0) await step.locator('[data-resource-id]').first().waitFor();
    else await step.getByText(index === 1 ? '还没有站点' : '还没有报告', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await header.getByRole('tab', { name: '表格', exact: true }).click();
  }
  // A late response from a previous type cannot replace the current step.
  let releaseSites; const oldSitesGate = new Promise(resolve => { releaseSites = resolve; });
  const delayedSites = async route => { await oldSitesGate; await route.fulfill({ json: [{ id: 'stale-site', name: '过期站点' }] }); };
  await page.route('**/api/sites', delayedSites);
  const oldSitesRequest = page.waitForRequest(request => request.url().endsWith('/api/sites'));
  await home(); await launcher.getByRole('button').nth(1).click(); await oldSitesRequest;
  await page.keyboard.press('Escape'); await launcher.getByRole('button').first().click();
  await step.locator('[data-resource-id]').first().waitFor();
  releaseSites(); await page.unroute('**/api/sites', delayedSites); await pause(100);
  assert.equal(await step.locator('[data-resource-id="stale-site"]').count(), 0);
  assert.equal(await step.getByRole('heading').innerText(), '选择表格');
  await page.keyboard.press('Escape'); await header.getByRole('tab', { name: '表格', exact: true }).click();
  const reports = [];
  for (let n = 0; n < 101; n++) reports.push(await api('/reports', { name: n === 0 ? '仅在第二页的报告' : `分页报告 ${n}`, columns: 1, widgets: [] }));
  await home(); await launcher.getByRole('button').nth(2).click();
  await step.locator('[data-resource-id]').first().waitFor(); assert.equal(await step.locator('[data-resource-id]').count(), 10);
  for (let n = 0; n < 10; n++) await next().click();
  await page.getByText('第 11 页，共 11 页', { exact: true }).waitFor(); assert(await next().isDisabled());
  assert.equal(await step.locator('[data-resource-id]').count(), 1);
  assert.equal(await step.locator('[data-resource-id]').first().getAttribute('data-resource-id'), reports[0].id);
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('preview-step-reports-page-11.png'), animations: 'disabled' });
  await search().fill('仅在第二页的报告'); await page.getByText('第 1 页，共 1 页', { exact: true }).waitFor();
  await page.keyboard.press('Enter'); await slot.getByTestId('preview-slot-report').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-resource-picker]')?.getAttribute('title') === '仅在第二页的报告');
  const sites = [];
  for (let n = 0; n < 12; n++) sites.push(await api('/sites', { name: n === 0 ? '入口站点' : `分页站点 ${n}`, files: [{ path: 'index.html', content: '<!doctype html><h1>入口站点正文</h1><input aria-label="站点草稿">' }] }));
  const site = sites[0];
  await home(); await launcher.getByRole('button').nth(1).click(); await step.locator('[data-resource-id]').first().waitFor();
  await next().click(); await page.getByText('第 2 页，共 2 页', { exact: true }).waitFor();
  assert(await next().isDisabled()); assert.equal(await step.locator('[data-resource-id]').count(), 2);
  await search().fill(site.name); await page.getByText('第 1 页，共 1 页', { exact: true }).waitFor();
  await page.locator(`[data-resource-id="${site.id}"]`).click();
  const frame = () => slot.locator('[role=tabpanel]:visible').frameLocator('iframe');
  await frame().getByRole('heading', { name: '入口站点正文' }).waitFor(); await frame().getByRole('textbox').fill('保留的站点草稿');
  for (const n of [1, 3, 2]) {
    await home(); await launcher.getByRole('button').nth(n - 1).click(); await step.waitFor();
    assert.equal(await header.getByRole('tab').count(), 3, 'one tab per type');
    await step.getByRole('button', { name: '返回上一步', exact: true }).click(); await launcher.waitFor();
  }
  await header.getByRole('tab', { name: '站点', exact: true }).click(); assert.equal(await frame().getByRole('textbox').inputValue(), '保留的站点草稿');
  await header.getByRole('tab', { name: '报告', exact: true }).focus(); await page.keyboard.press('Enter');
  assert(await header.getByRole('tab', { name: '报告', exact: true }).evaluate(el => el === document.activeElement));
  assert.equal(await step.count(), 0); await page.keyboard.press('Tab'); assert.equal(await page.locator('[cmdk-list]').count(), 0);
  await picker().focus(); await shortcut(3); await step.waitFor(); assert.equal(await picker().count(), 0, 'cached shortcut also enters second step');
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail })), { kind: 'site', siteId: site.id });
  await frame().getByRole('heading', { name: '入口站点正文' }).waitFor(); assert.equal(await step.count(), 0, 'resource-bearing tool event bypasses step');
  const captureLauncher = async scenario => {
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.mouse.move(2, 2); await pause(150);
    assert(await launcher.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert(await launcher.evaluate(el => { const bounds = el.getBoundingClientRect(), content = el.firstElementChild.getBoundingClientRect(); return Math.abs((bounds.x + bounds.width / 2) - (content.x + content.width / 2)) < 2 && Math.abs((bounds.y + bounds.height / 2) - (content.y + content.height / 2)) < 2; }), 'entries centered in both axes');
    const first = launcher.getByRole('button').first();
    const initial = await first.evaluate(el => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return { background: style.backgroundColor, canvas: getComputedStyle(el.closest('[data-testid=workspace-preview-slot]')).backgroundColor, border: style.borderTopWidth, height: rect.height, width: rect.width, scroll: el.scrollWidth, client: el.clientWidth };
    });
    assert.notEqual(initial.background, initial.canvas, 'default action has its own surface');
    assert.equal(initial.border, '1px'); assert.equal(initial.height, 80);
    assert(initial.width <= 384 && initial.scroll <= initial.client + 1, scenario + ': action content fits');
    if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-launcher-${scenario}-default.png`), animations: 'disabled' });
    await first.hover(); await pause(150);
    assert.notEqual(await first.evaluate(el => getComputedStyle(el).backgroundColor), initial.background, 'hover distinguishes the action in both themes');
    if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-launcher-${scenario}-hover.png`), animations: 'disabled' });
    await page.mouse.move(2, 2); await first.focus(); await page.keyboard.press('Tab'); await pause(150);
    assert(await launcher.getByRole('button').nth(1).evaluate(el => el.matches(':focus-visible')), 'keyboard focus visible');
    if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-launcher-${scenario}-focus.png`), animations: 'disabled' });
  };
  for (const locale of ['zh-CN', 'en']) {
    await page.evaluate(locale => localStorage.setItem('tabdo.locale', locale), locale); await page.reload(); await page.getByTestId('workspace-preview-toggle').click();
    for (const width of [1440, 1024]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await captureLauncher(`${locale}-${width}-${theme}`);
      await launcher.getByRole('button').first().click(); await step.waitFor();
      await step.locator('[data-resource-id]').first().waitFor();
      await assertStepFits();
      if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-step-${locale}-${width}-${theme}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
    const handle = await page.getByTestId('workspace-home-split').locator('[data-separator]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 22); await page.mouse.down(); await page.mouse.move(1024 - 200, handle.y + 22, { steps: 10 }); await page.mouse.up();
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-testid=workspace-preview-slot]').getBoundingClientRect().width - 264) < 1);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await captureLauncher(`${locale}-minimum-264-${theme}`);
      await launcher.getByRole('button').first().click(); await step.locator('[data-resource-id]').first().waitFor();
      await assertStepFits();
      if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-step-${locale}-minimum-264-${theme}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
  }
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => sessionStorage.getItem('preview-test-platform') ?? 'MacIntel', configurable: true }));
  for (const platform of ['MacIntel', 'Win32', 'Linux x86_64']) {
    await page.evaluate(platform => sessionStorage.setItem('preview-test-platform', platform), platform);
    await page.reload(); await page.getByTestId('workspace-preview-toggle').click();
    assert.equal(await launcher.locator('kbd').first().innerText(), platform === 'MacIntel' ? '⌃⇧1' : 'Ctrl+Shift+1');
    const handle = await page.getByTestId('workspace-home-split').locator('[data-separator]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 22); await page.mouse.down(); await page.mouse.move(824, handle.y + 22, { steps: 10 }); await page.mouse.up();
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-testid=workspace-preview-slot]').getBoundingClientRect().width - 264) < 1);
    assert(await launcher.getByRole('button').evaluateAll(buttons => buttons.every(el => el.scrollWidth <= el.clientWidth + 1)), platform + ': minimum split fits longer shortcut labels');
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await shortcut(3); await step.waitFor(); assert.equal(await header.getByRole('tab').count(), 0);
  }
  const other = (await api('/commands', { command: 'createWorkspace', input: { name: '独立空工作区' } })).result;
  await page.reload(); await page.getByTestId('workspace-home-split').waitFor();
  await page.getByTestId('workspace-switcher').click(); await page.getByRole('menuitem', { name: other.name, exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('workspace') === other.id);
  await page.getByTestId('workspace-home-split').waitFor(); await page.locator('body').click({ position: { x: 2, y: 2 } }); await shortcut(1);
  await page.locator('[cmdk-list]').getByText('No tables yet', { exact: true }).waitFor(); assert.equal(await page.locator('[data-resource-id]').count(), 0);
  await page.keyboard.press('Escape');
  // Scope also stays attached when opening resources in the switched workspace.
  const response = await ctx.request.post(base + '/api/tables', { headers: { Origin: frontend, 'X-Workspace-Id': other.id }, data: { name: '当前工作区表格' } }); assert(response.ok()); const local = await response.json();
  await page.reload(); await page.getByTestId('workspace-home-split').waitFor(); await page.locator('body').click({ position: { x: 2, y: 2 } }); await shortcut(1); await page.locator(`[data-resource-id="${local.id}"]`).waitFor(); assert.equal(await page.locator('[data-resource-id]').count(), 1);
  await page.keyboard.press('Escape');
  await page.goto(frontend + '/app/tables?workspace=' + other.id); await page.getByTestId('app-sidebar').waitFor(); await shortcut(2); assert.equal(await page.getByTestId('workspace-preview-slot').count(), 0, 'only conversation page registers shortcuts');
  assert.deepEqual(f.errors, []);
  console.log('PASS centered two-step selection with bordered surface; tables/sites/reports pagination (reports >100); all-resource search and resets; Enter/Escape/Tab and Control/IME guards; cache and direct tools; loading/error/retry/late responses; workspace isolation; zh/en light/dark 1440/1024/264px screenshots.');
} catch (error) {
  await page.screenshot({ path: artifact('preview-launcher-failure.png') });
  throw error;
} finally { await f.close(); }
