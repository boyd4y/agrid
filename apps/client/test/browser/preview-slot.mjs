import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: '三类预览与资源缓存' });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const open = async payload => {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail })), payload);
  const id = payload.siteId ?? payload.reportId ?? payload.tableId;
  await slot.locator(`[data-preview-resource-id="${id}"]:not([hidden])`).waitFor();
};
const slot = page.getByTestId('workspace-preview-slot'), header = slot.getByTestId('preview-slot-header');
const tab = name => header.getByRole('tab', { name, exact: true });
const picker = () => header.getByTestId('preview-resource-picker');
const select = async resource => { await picker().click(); await page.locator(`[data-resource-id="${resource.id}"]`).click(); };
const frame = () => slot.locator('[role=tabpanel]:visible').frameLocator('iframe');
const refresh = () => header.getByRole('button', { name: '刷新工作面板', exact: true });
let previews = 0;
page.on('request', request => { if (/\/api\/sites\/[^/]+\/preview$/.test(request.url())) previews++; });
try {
  const table = await api('/tables', { name: '客户资料' });
  const form = await command('createFormView', { tableId: table.id, name: '联系申请', title: '提交申请' });
  const sites = [];
  for (const name of ['活动页面', '另一页面']) sites.push(await api('/sites', { name, files: [{ path: 'index.html', content: `<!doctype html><h1>${name}正文</h1><label>现场草稿<input aria-label="现场草稿"></label>` }] }));
  const report = await api('/reports', { name: '客户汇总', description: '真实报告', columns: 2, widgets: [{ id: crypto.randomUUID(), type: 'metric', title: '客户总数', width: 'full', query: { tableId: table.id, metric: 'count', valueColumnId: null } }] });
  await page.goto(frontend + '/app');
  await page.getByTestId('workspace-preview-toggle').click();
  const launcher = slot.getByTestId('preview-launcher');
  assert.equal(await launcher.getByRole('button').count(), 3);
  await launcher.getByRole('button', { name: /表格/ }).click();
  await select(table); await slot.getByTestId('preview-slot-table').waitFor();
  await open({ kind: 'site', siteId: sites[0].id });
  await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  await frame().getByRole('textbox').fill('切换保留');
  const initial = previews;
  await header.getByRole('button', { name: '预览首页', exact: true }).click();
  await launcher.waitFor(); assert.equal(await header.getByRole('tab').count(), 2);
  await tab('站点').click(); assert.equal(await frame().getByRole('textbox').inputValue(), '切换保留');
  await open({ kind: 'site', siteId: sites[1].id });
  await frame().getByRole('heading', { name: '另一页面正文' }).waitFor();
  assert.equal(await tab('站点').count(), 1);
  await select(sites[0]); assert.equal(await frame().getByRole('textbox').inputValue(), '切换保留');
  assert.equal(previews, initial + 1, 'same-type switch and home preserve iframe identity');
  await open({ kind: 'form', tableId: table.id, viewId: form.id });
  await slot.getByTestId('preview-slot-form').getByRole('textbox').first().fill('未提交草稿');
  await open({ kind: 'automations', tableId: table.id });
  await slot.getByTestId('preview-slot-automations').getByRole('button', { name: '新建自动化', exact: true }).first().waitFor();
  await tab('表单').click(); assert.equal(await slot.getByTestId('preview-slot-form').getByRole('textbox').first().inputValue(), '未提交草稿');
  await open({ kind: 'report', reportId: report.id });
  await slot.getByText('客户总数', { exact: true }).waitFor();
  assert.equal(await slot.getByTestId('preview-slot-report').getByRole('button', { name: /保存|编辑/ }).count(), 0);
  const otherReport = await api('/reports', { name: '第二报告', description: '', columns: 1, widgets: [] });
  await open({ kind: 'report', reportId: otherReport.id });
  assert.equal(await tab('报告').count(), 1);
  await select(report); await slot.getByText('客户总数', { exact: true }).waitFor();
  await tab('站点').click();
  const oldUrl = await slot.locator('[role=tabpanel]:visible iframe').getAttribute('src');
  await refresh().click();
  await page.waitForFunction(old => document.querySelector('[role=tabpanel]:not([hidden]) iframe')?.getAttribute('src') !== old, oldUrl);
  await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  for (const suffix of ['/preview', '']) {
    const failure = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '资源暂不可用' }) });
    await page.route(`**/api/sites/${sites[0].id}${suffix}`, failure);
    await refresh().click(); await slot.getByRole('alert').waitFor();
    await page.unroute(`**/api/sites/${sites[0].id}${suffix}`, failure);
    await refresh().click(); await slot.getByRole('alert').waitFor({ state: 'hidden' });
    await frame().getByRole('heading', { name: '活动页面正文' }).waitFor();
  }
  const before = previews;
  for (const [name, matches] of [
    ['表格', request => request.method() === 'GET' && request.url().endsWith(`/tables/${table.id}`)],
    ['表单', request => request.method() === 'POST' && request.url().endsWith('/api/commands') && request.postDataJSON()?.command === 'getView'],
    ['自动化', request => request.method() === 'GET' && request.url().includes('/automations')],
    ['报告', request => request.method() === 'GET' && request.url().endsWith(`/reports/${report.id}`)],
  ]) { await tab(name).click(); const request = page.waitForRequest(matches); await refresh().click(); await request; }
  assert.equal(previews, before, 'unrelated refresh never regenerates sites');
  // A hidden cached blog still owns its close guard and configuration draft.
  const blogs = [];
  for (const name of ['第一博客', '第二博客']) blogs.push(await command('createBlog', { name, idempotencyKey: crypto.randomUUID() }));
  const visibleBlog = () => slot.locator('[data-preview-resource-id]:not([hidden])').getByTestId('blog-editor');
  for (const [index, blog] of blogs.entries()) {
    await open({ kind: 'site', siteId: blog.id }); await visibleBlog().waitFor();
    await visibleBlog().getByRole('tab', { name: '配置', exact: true }).click();
    await visibleBlog().getByRole('textbox', { name: '博客名称', exact: true }).fill(`博客草稿 ${index}`);
  }
  await open({ kind: 'site', siteId: sites[0].id });
  await header.getByRole('button', { name: '关闭站点 Tab', exact: true }).click();
  await page.getByRole('dialog', { name: '仍有内容未保存' }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).first().click();
  await open({ kind: 'site', siteId: blogs[0].id });
  assert.equal(await visibleBlog().getByRole('textbox', { name: '博客名称', exact: true }).inputValue(), '博客草稿 0');
  // Simulate a concurrent save using the real service; failed save keeps the local draft.
  const latest = await command('getBlog', { siteId: blogs[0].id });
  await command('saveBlog', { siteId: latest.id, expectedVersion: latest.version, name: '远端名称', config: latest.config, idempotencyKey: crypto.randomUUID() });
  await visibleBlog().getByRole('button', { name: '保存配置', exact: true }).click();
  await visibleBlog().getByRole('alert').waitFor();
  assert.equal(await visibleBlog().getByRole('textbox', { name: '博客名称', exact: true }).inputValue(), '博客草稿 0');
  await open({ kind: 'site', siteId: sites[0].id });
  await header.getByRole('button', { name: '关闭站点 Tab', exact: true }).click();
  for (let index = 0; index < 2; index++) {
    await page.getByRole('dialog', { name: '仍有内容未保存' }).waitFor();
    await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click();
  }
  await header.getByRole('tab', { name: '站点', exact: true }).waitFor({ state: 'hidden' });
  for (const [index, blog] of blogs.entries()) {
    await open({ kind: 'site', siteId: blog.id }); await visibleBlog().waitFor();
    await visibleBlog().getByRole('tab', { name: '配置', exact: true }).click();
    assert.equal(await visibleBlog().getByRole('textbox', { name: '博客名称', exact: true }).inputValue(), `博客草稿 ${index}`);
  }
  await header.getByRole('button', { name: '关闭站点 Tab', exact: true }).click();
  for (let index = 0; index < 2; index++) { await page.getByRole('dialog', { name: '仍有内容未保存' }).waitFor(); await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click(); }
  assert.equal(await slot.locator('header').count(), 1);
  for (const name of ['表格', '表单', '自动化', '报告']) { await tab(name).click(); await header.getByRole('button', { name: `关闭${name} Tab`, exact: true }).click(); }
  await launcher.waitFor(); assert.equal(await header.getByRole('tab').count(), 0);
  assert.deepEqual(f.errors, []);
  console.log('PASS unique type tabs, actual table/report/HTML/form/automation, resource switching, cache/drafts, real refresh and retry, close type.');
} catch (error) {
  await page.screenshot({ path: f.artifact('preview-slot-failure.png') });
  console.error('PREVIEW DIAGNOSTICS', await slot.evaluate(el => [...el.querySelectorAll('[data-testid="blog-editor"], [role=tabpanel], [role=tab]')].map(node => ({ role: node.getAttribute('role'), id: node.id, name: node.getAttribute('aria-label'), hidden: node.hidden, rect: node.getBoundingClientRect().toJSON(), parent: node.parentElement.className, class: node.className }))));
  throw error;
} finally { await f.close(); }
