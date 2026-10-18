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
  const initialPreviews = previews;
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
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + 100, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up();
  await assertActiveVisible(resources[2].name, 'resize-panel');
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
} finally { await f.close(); }
