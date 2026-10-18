import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';

const f = await createBrowserFixture({ name: '按需资源单标题栏' });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const open = async payload => page.evaluate(detail => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail })), payload);
const slot = page.getByTestId('workspace-preview-slot');
const header = slot.getByTestId('preview-slot-header');
const refresh = () => header.getByRole('button', { name: '刷新工作面板', exact: true });
const tab = name => header.getByRole('tab', { name, exact: true });
let previewRequests = 0;
page.on('request', request => { if (/\/api\/sites\/[^/]+\/preview$/.test(request.url())) previewRequests++; });
try {
  const table = await api('/tables', { name: '客户资料' });
  const form = await command('createFormView', { tableId: table.id, name: '联系申请', title: '提交申请' });
  const site = await api('/sites', { name: '活动页面', files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>活动页面正文</h1><label>现场草稿<input aria-label="现场草稿"></label></body></html>' }] });
  const other = await api('/sites', { name: '另一页面', files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>另一页面正文</h1></body></html>' }] });
  await page.goto(frontend + '/app');
  await page.getByTestId('workspace-preview-toggle').click();
  assert.equal(await header.getByRole('button').count(), 1);
  assert.equal(await slot.getByRole('tab').count(), 0);
  assert.equal(await slot.locator('p').count(), 0, 'empty body has no explanatory copy');
  await header.getByRole('button', { name: '打开表格', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: table.name, exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem').count(), 1, 'only existing tables, no type catalog');
  await page.getByRole('menuitem', { name: table.name, exact: true }).click();
  await tab('表格 · 客户资料').waitFor();
  await slot.getByTestId('preview-slot-table').waitFor();
  await open({ kind: 'site', siteId: site.id });
  await tab('站点 · 活动页面').waitFor();
  const frame = () => slot.locator('[role=tabpanel]:visible').frameLocator('iframe');
  await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  await frame().getByRole('textbox', { name: '现场草稿' }).fill('切换保留');
  const initialRequests = previewRequests;
  assert.equal(await slot.locator('header').count(), 1);
  assert.equal(await slot.getByRole('button', { name: /刷新/ }).count(), 1);
  assert.equal(await header.getByRole('link', { name: '编辑站点', exact: true }).count(), 1);
  await open({ kind: 'site', siteId: other.id });
  await frame().getByRole('heading', { name: '另一页面正文' }).waitFor();
  await tab('站点 · 活动页面').click();
  assert.equal(await frame().getByRole('textbox', { name: '现场草稿' }).inputValue(), '切换保留');
  assert.equal(previewRequests, initialRequests + 1, 'switching same-kind resources does not reload either frame');
  await open({ kind: 'form', tableId: table.id, viewId: form.id });
  await slot.getByTestId('preview-slot-form').getByRole('textbox').first().fill('表单未提交草稿');
  await tab('表单 · 联系申请').waitFor();
  await open({ kind: 'automations', tableId: table.id });
  await slot.getByTestId('preview-slot-automations').getByRole('button', { name: '新建自动化', exact: true }).first().waitFor();
  await open({ kind: 'table', tableId: table.id });
  await slot.getByTestId('preview-slot-table').waitFor();
  await tab('表单 · 联系申请').click();
  assert.equal(await slot.getByTestId('preview-slot-form').getByRole('textbox').first().inputValue(), '表单未提交草稿');
  await tab('站点 · 活动页面').focus(); await page.keyboard.press('Enter');
  assert.equal(await frame().getByRole('textbox', { name: '现场草稿' }).inputValue(), '切换保留');
  // A real preview generation, and failures recover through the same single refresh.
  const oldUrl = await slot.locator('[role=tabpanel]:visible iframe').getAttribute('src');
  const regenerated = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith(`/sites/${site.id}/preview`));
  await refresh().click(); await regenerated;
  await page.waitForFunction(old => document.querySelector('[role=tabpanel]:not([hidden]) iframe')?.getAttribute('src') !== old, oldUrl);
  await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  const failure = async route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '预览暂不可用' }) });
  await page.route(`**/api/sites/${site.id}/preview`, failure);
  await refresh().click(); await slot.getByRole('alert').waitFor();
  await page.unroute(`**/api/sites/${site.id}/preview`, failure);
  await refresh().click(); await slot.getByRole('alert').waitFor({ state: 'hidden' });
  await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  const failedRead = async route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '资源暂不可用' }) });
  await page.route(`**/api/sites/${site.id}`, failedRead);
  await refresh().click(); await slot.getByRole('alert').waitFor();
  await page.unroute(`**/api/sites/${site.id}`, failedRead);
  await refresh().click(); await slot.getByRole('alert').waitFor({ state: 'hidden' });
  await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  // Refresh each table-backed kind and observe the actual resource requests.
  const requestsBeforeDatasetRefresh = previewRequests;
  for (const [name, matches] of [
    ['表格 · 客户资料', request => request.method() === 'GET' && request.url().endsWith(`/tables/${table.id}`)],
    ['表单 · 联系申请', request => request.method() === 'POST' && request.url().endsWith('/api/commands') && request.postDataJSON()?.command === 'getView'],
    ['自动化 · 客户资料', request => request.method() === 'GET' && request.url().includes('/automations')],
  ]) {
    await tab(name).click(); const reloaded = page.waitForRequest(matches); await refresh().click(); await reloaded;
  }
  await tab('站点 · 活动页面').click();
  await pause(700);
  assert.equal(previewRequests, requestsBeforeDatasetRefresh, 'dataset refresh does not regenerate unrelated sites');
  for (const width of process.env.BROWSER_SKIP_VISUALS ? [] : [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await pause(100);
    assert(await header.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'header fits its panel');
    assert(await slot.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'preview fits its panel');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits viewport');
    await page.screenshot({ path: artifact(`preview-${width}-${theme}.png`) });
  }
  for (const name of ['表格 · 客户资料', '表单 · 联系申请', '自动化 · 客户资料', '站点 · 另一页面', '站点 · 活动页面']) {
    await header.getByRole('button', { name: `关闭${name} Tab`, exact: true }).click();
  }
  assert.equal(await header.getByRole('button').count(), 1);
  assert.equal(await slot.locator('p').count(), 0);
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-slot-header]')?.contains(document.activeElement));
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('preview-empty-320-dark.png') });
  await page.evaluate(() => localStorage.setItem('tabdo.locale', 'en')); await page.reload();
  await page.getByTestId('workspace-preview-toggle').click();
  await header.getByRole('button', { name: 'Open table', exact: true }).waitFor();
  assert.equal(await header.getByRole('button').count(), 1);
  assert.deepEqual(f.errors, []);
  console.log('PASS preview slot: blank table-only shortcut; event-opened site/table/form/automation; same-kind tabs; keyboard switching; real refresh per resource; errors/retry; form and iframe state retained; close all; single header/refresh; 1440/390/320 light+dark.');
} catch (error) {
  console.error('Preview diagnostics:', page.url(), (await slot.innerText().catch(() => '')).slice(0, 1600), f.errors);
  throw error;
} finally { await f.close(); }
