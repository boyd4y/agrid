import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: '当前预览资源可见性' });
const { page, api, frontend, artifact } = f;
page.setDefaultTimeout(15000);
const header = page.getByTestId('preview-slot-header');
const slot = page.getByTestId('workspace-preview-slot');
const open = siteId => page.evaluate(siteId => window.dispatchEvent(new CustomEvent('tabdo:open-preview', { detail: { kind: 'site', siteId } })), siteId);
const frame = () => slot.locator('[role=tabpanel]:visible').frameLocator('iframe');
let previews = 0;
page.on('request', request => { if (/\/api\/sites\/[^/]+\/preview$/.test(request.url())) previews++; });

async function waitForPanelOrientation() {
  await page.waitForFunction(() => {
    const chat = document.querySelector('[data-testid=chat-panel]')?.getBoundingClientRect();
    const preview = document.querySelector('[data-testid=workspace-preview-slot]')?.getBoundingClientRect();
    return chat && preview && (innerWidth < 768 ? preview.top >= chat.bottom - 1 : preview.left >= chat.right - 1);
  });
}

async function assertActiveVisible(name, scenario) {
  // Playwright's visible/focus checks alone do not detect clipping inside a tab strip.
  await page.waitForFunction(name => {
    const list = document.querySelector('[data-testid=preview-slot-header] [role=tablist]');
    const selected = list?.querySelector('[role=tab][aria-selected=true]');
    const label = selected?.querySelector('span'), close = selected?.parentElement.querySelector('button:not([role=tab])');
    if (!list || !label || !close || label.textContent !== name) return false;
    const bounds = list.getBoundingClientRect(), title = label.getBoundingClientRect(), action = close.getBoundingClientRect();
    const visible = Math.max(0, Math.min(bounds.right, title.right) - Math.max(bounds.left, title.left));
    return visible > 20 && action.left >= bounds.left - 1 && action.right <= bounds.right + 1;
  }, name);
  const geometry = await header.evaluate(el => {
    const list = el.querySelector('[role=tablist]'), selected = list.querySelector('[role=tab][aria-selected=true]');
    const bounds = list.getBoundingClientRect(), label = selected.querySelector('span').getBoundingClientRect();
    return { title: selected.textContent, scrollLeft: list.scrollLeft, listWidth: bounds.width,
      visibleLabelWidth: Math.max(0, Math.min(bounds.right, label.right) - Math.max(bounds.left, label.left)) };
  });
  console.log(JSON.stringify({ scenario, ...geometry }));
}

try {
  await page.setViewportSize({ width: 320, height: 844 });
  const resources = [];
  for (const name of ['第一个活动页面', '第二个活动页面', '第三个活动页面']) resources.push(await api('/sites', { name, files: [{ path: 'index.html', content: `<!doctype html><h1>${name}</h1><label>页面草稿<input aria-label="页面草稿"></label>` }] }));
  await page.goto(frontend + '/app');
  await page.getByTestId('workspace-home-split').waitFor();
  for (const site of resources) {
    await open(site.id);
    await header.getByRole('tab', { name: `站点 · ${site.name}`, exact: true }).waitFor({ state: 'attached' });
    await assertActiveVisible(site.name, 'open-at-320');
    await frame().getByRole('heading', { name: site.name, exact: true }).waitFor();
    if (site === resources[0]) await frame().getByRole('textbox', { name: '页面草稿' }).fill('切换和缩放均保留');
  }
  let initialPreviews = previews;
  await open(resources[0].id);
  await assertActiveVisible(resources[0].name, 'event-switch-to-first');
  assert.equal(await frame().getByRole('textbox', { name: '页面草稿' }).inputValue(), '切换和缩放均保留');
  await open(resources[2].id);
  await assertActiveVisible(resources[2].name, 'event-switch-to-third');
  await header.getByRole('tab', { name: `站点 · ${resources[2].name}`, exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await assertActiveVisible(resources[1].name, 'keyboard-left');
  await page.keyboard.press('Home');
  await assertActiveVisible(resources[0].name, 'keyboard-home');
  await page.keyboard.press('End');
  await assertActiveVisible(resources[2].name, 'keyboard-end');

  // Resize from a fitting desktop strip to both narrow widths without focusing the tab.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await waitForPanelOrientation();
  await assertActiveVisible(resources[2].name, 'resize-desktop');
  const handle = await page.getByTestId('workspace-home-split').locator('[data-separator]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 22);
  await page.mouse.down(); await page.mouse.move(handle.x + 100, handle.y + 22, { steps: 5 }); await page.mouse.up();
  await assertActiveVisible(resources[2].name, 'resize-panel');
  await page.setViewportSize({ width: 1024, height: 900 });
  await waitForPanelOrientation();
  const expandSidebar = page.getByRole('button', { name: /展开侧栏|Expand sidebar/, exact: true });
  if (await expandSidebar.count()) await expandSidebar.click();
  await page.waitForFunction(() => document.querySelector('[data-testid=app-sidebar]')?.getBoundingClientRect().width === 240);
  const splitter = page.getByTestId('workspace-home-split').locator('[data-separator]');
  // Stay over the parent header; a sandboxed iframe does not deliver pointerup to its parent document.
  const dragToWidth = async width => {
    const bounds = await splitter.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 22);
    await page.mouse.down(); await page.mouse.move(1024 - width, bounds.y + 22, { steps: 10 }); await page.mouse.up();
  };
  await dragToWidth(230);
  console.log('Minimum drag:', await slot.evaluate(el => ({ width: el.getBoundingClientRect().width, group: document.getElementById('workspace-home')?.getBoundingClientRect().toJSON(), separator: document.querySelector('[data-separator]')?.getBoundingClientRect().toJSON() })));
  await page.waitForFunction(() => {
    const width = document.querySelector('[data-testid=workspace-preview-slot]')?.getBoundingClientRect().width;
    return width >= 263.5 && width <= 264.5;
  });
  await dragToWidth(180);
  assert(Math.abs(await slot.evaluate(el => el.getBoundingClientRect().width) - 264) < 1, 'desktop dragging clamps to the usable pixel minimum');
  await assertActiveVisible(resources[2].name, '1024-sidebar-240-minimum-panel-264');
  console.log(JSON.stringify(await slot.evaluate(el => ({ scenario: 'actual-minimum', viewport: innerWidth, sidebar: document.querySelector('[data-testid=app-sidebar]').getBoundingClientRect().width, panel: el.getBoundingClientRect().width }))));
  // A delayed actual title also adds the editor action, reducing the strip's available width.
  const delayed = await api('/sites', { name: '异步返回的第四个超长站点名称', files: [{ path: 'index.html', content: '<!doctype html><h1>延迟标题正文</h1>' }] });
  let releaseTitle;
  const titleGate = new Promise(resolve => { releaseTitle = resolve; });
  const delayedTitle = async route => { await titleGate; await route.fallback(); };
  await page.route(`**/api/sites/${delayed.id}`, delayedTitle);
  const titleRequested = page.waitForRequest(request => request.method() === 'GET' && request.url().endsWith(`/sites/${delayed.id}`));
  await open(delayed.id); await titleRequested; releaseTitle();
  await header.getByRole('tab', { name: `站点 · ${delayed.name}`, exact: true }).waitFor({ state: 'attached' });
  await assertActiveVisible(delayed.name, 'async-title-at-minimum');
  await frame().getByRole('heading', { name: '延迟标题正文', exact: true }).waitFor();
  await page.unroute(`**/api/sites/${delayed.id}`, delayedTitle);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`active-tab-1024-min-${theme}.png`), animations: 'disabled' });
  }
  initialPreviews = previews;
  await header.getByRole('button', { name: `关闭站点 · ${delayed.name} Tab`, exact: true }).click();
  await assertActiveVisible(resources[2].name, 'close-delayed-title');
  for (const width of [390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 844 });
    await waitForPanelOrientation();
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await assertActiveVisible(resources[2].name, `resize-${width}-${theme}`);
    if (!process.env.BROWSER_SKIP_VISUALS) await page.screenshot({ path: artifact(`active-tab-${width}-${theme}.png`), animations: 'disabled' });
  }
  assert.equal(previews, initialPreviews, 'switching and resizing never regenerate mounted site previews');
  await header.getByRole('button', { name: `关闭站点 · ${resources[2].name} Tab`, exact: true }).click();
  await assertActiveVisible(resources[1].name, 'close-current');
  await open(resources[0].id);
  await assertActiveVisible(resources[0].name, 'return-to-draft');
  assert.equal(await frame().getByRole('textbox', { name: '页面草稿' }).inputValue(), '切换和缩放均保留');
  assert.equal(previews, initialPreviews);
  assert.deepEqual(f.errors, []);
  console.log('PASS active resource header: tool-opened title and close visible; event/keyboard switching; 1440→390→320 resize; light/dark; iframe identity and draft retained.');
} catch (error) {
  console.error('Active tab diagnostics:', await slot.evaluate(el => ({ width: el.getBoundingClientRect().width, group: document.getElementById('workspace-home')?.outerHTML.slice(0, 1800), separator: document.querySelector('[data-separator]')?.outerHTML })));
  throw error;
} finally { await f.close(); }
