import assert from 'node:assert/strict';
import { createBrowserFixture, pause } from './fixture.mjs';
const f = await createBrowserFixture({ name: '类型标签与窄屏' });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const slot = page.getByTestId('workspace-preview-slot'), header = page.getByTestId('preview-slot-header');
const open = detail => page.evaluate(detail => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail })), detail);
const frame = () => slot.locator('[role=tabpanel]:visible').frameLocator('iframe');
let previews = 0;
page.on('request', request => { if (/\/api\/sites\/[^/]+\/preview$/.test(request.url())) previews++; });
async function assertFits(scenario) {
  await pause(120);
  assert(await slot.evaluate(el => el.scrollWidth <= el.clientWidth + 1), scenario + ': panel');
  assert(await header.evaluate(el => el.scrollWidth <= el.clientWidth + 1), scenario + ': header');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), scenario + ': page');
  assert(await header.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return [...el.querySelectorAll('[data-testid=preview-resource-picker], button[aria-label^="关闭"], button[aria-label="预览首页"]')].every(item => { const r = item.getBoundingClientRect(); return r.width > 0 && r.left >= bounds.left - 1 && r.right <= bounds.right + 1; });
  }), scenario + ': resource selector and close accessible');
  const active = header.getByRole('tab', { selected: true });
  if (await active.count()) assert(await active.evaluate(el => { const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; }), scenario + ': active type visible');
}
try {
  const sites = [];
  for (const name of ['第一个页面', '连续很长站点名称'.repeat(12), '第三个页面']) sites.push(await api('/sites', { name, files: [{ path: 'index.html', content: `<!doctype html><h1>${name}</h1><input aria-label="草稿">` }] }));
  const table = await api('/tables', { name: '表格长名称'.repeat(20) });
  const report = await api('/reports', { name: '报告长名称'.repeat(20), columns: 2, widgets: [] });
  await page.goto(frontend + '/app');
  await page.getByTestId('workspace-home-split').waitFor();
  for (const site of sites) {
    await open({ kind: 'site', siteId: site.id });
    await frame().getByRole('heading', { name: site.name, exact: true }).waitFor();
    if (site === sites[0]) await frame().getByRole('textbox').fill('缩放保留');
    assert.equal(await header.getByRole('tab', { name: '站点', exact: true }).count(), 1);
  }
  await open({ kind: 'table', tableId: table.id });
  await open({ kind: 'report', reportId: report.id });
  assert.equal(await header.getByRole('tab').count(), 3);
  for (const width of [1440, 1024]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    for (const name of ['表格', '站点', '报告']) { await header.getByRole('tab', { name, exact: true }).click(); await assertFits(`${width}-${theme}-${name}`); }
    if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`preview-types-${width}-${theme}.png`), animations: 'disabled' });
  }
  // Real desktop split clamps at 264px with the sidebar expanded.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForFunction(() => { const chat = document.querySelector('[data-testid=chat-panel]')?.getBoundingClientRect(); const preview = document.querySelector('[data-testid=workspace-preview-slot]')?.getBoundingClientRect(); return chat && preview && preview.left >= chat.right - 1; });
  const expand = page.getByRole('button', { name: /展开侧栏|Expand sidebar/, exact: true });
  if (await expand.count()) await expand.click();
  const handle = await page.getByTestId('workspace-home-split').locator('[data-separator]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 22); await page.mouse.down(); await page.mouse.move(1024 - 200, handle.y + 22, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-testid=workspace-preview-slot]').getBoundingClientRect().width - 264) < 1);
  for (const name of ['表格', '站点', '报告']) { await header.getByRole('tab', { name, exact: true }).click(); await assertFits(`264-${name}`); }
  if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact('preview-types-minimum-264.png'), animations: 'disabled' });
  const before = previews;
  await open({ kind: 'site', siteId: sites[0].id });
  assert.equal(await frame().getByRole('textbox').inputValue(), '缩放保留');
  assert.equal(previews, before);
  await header.getByRole('tab', { name: '站点', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await header.getByRole('tab', { name: '表格', exact: true, selected: true }).waitFor();
  await page.keyboard.press('End');
  await header.getByRole('tab', { name: '报告', exact: true, selected: true }).waitFor();
  assert.deepEqual(f.errors, []);
  console.log('PASS three unique tabs, 264px desktop minimum, long names, type keyboard navigation, iframe identity, light/dark.');
} finally { await f.close(); }
