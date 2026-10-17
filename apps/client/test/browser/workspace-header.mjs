import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Workspace header regression' });
const { page, frontend, api } = f;
page.setDefaultTimeout(15000);
const trigger = () => page.getByTestId('workspace-switcher');
const sidebar = () => page.getByTestId('app-sidebar');
const createItem = () => page.getByRole('menuitem', { name: /创建工作区|Create workspace/ });
const nameInput = () => page.getByLabel(/工作区名称|Workspace name/);
const submit = () => page.getByRole('button', { name: /创建并进入|Create and enter|正在创建|Creating/ });
let releaseCreate = () => {}, releaseSwitch = () => {};

async function openWithKeyboard() {
  await trigger().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menu').waitFor();
}

async function waitForSidebarWidth(width) {
  await page.waitForFunction(expected => document.querySelector('[data-testid="app-sidebar"]')?.getBoundingClientRect().width === expected, width);
}

async function assertMenuFits(width) {
  const menu = page.getByRole('menu');
  const box = await menu.boundingBox();
  assert(box && box.x >= 0 && box.x + box.width <= width);
  assert(await menu.evaluate(el => el.scrollWidth <= el.clientWidth), 'Menu must not overflow horizontally');
}

try {
  const a = (await api('/commands', { command: 'listWorkspaces' })).result.find(item => item.isDefault);
  const longName = '很长的项目工作区名称 Long workspace name '.repeat(4).slice(0, 100).trim();
  await page.goto(frontend + '/app/tables?workspace=' + a.id);
  await trigger().waitFor();
  assert.equal(await trigger().count(), 1);
  assert.equal(await trigger().evaluate(el => el.tagName), 'BUTTON');
  assert.equal(await trigger().locator('a, button').count(), 0, 'No nested interactive controls');
  const top = sidebar().locator(':scope > div').first();
  assert.equal(await top.getByTestId('workspace-switcher').count(), 1, 'Switcher belongs to the brand header');
  assert.equal(await sidebar().locator('[data-tabdo-mark]').count(), 1, 'Only one brand entry');
  await top.screenshot({ path: f.artifact('header-expanded-light.png') });

  // The mark opens the menu without taking the old Logo home link.
  const originalUrl = page.url();
  await trigger().locator('[data-tabdo-mark]').click();
  await page.getByRole('menu').waitFor();
  assert.equal(page.url(), originalUrl);
  await page.getByRole('menuitem').filter({ hasText: a.name }).getByLabel(/当前|Current/).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-testid="workspace-switcher"]') === document.activeElement);

  // Tab reaches the independent collapse control; its activation must not open a menu.
  await page.keyboard.press('Tab');
  const collapse = page.getByRole('button', { name: /收起侧栏|Collapse sidebar/, exact: true });
  assert(await collapse.evaluate(el => el === document.activeElement));
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /展开侧栏|Expand sidebar/, exact: true }).waitFor();
  await waitForSidebarWidth(56);
  assert.equal(await page.getByRole('menu').count(), 0);
  await trigger().locator('[data-tabdo-mark]').click();
  await page.getByRole('menu').waitFor();
  await assertMenuFits(1600);
  await page.screenshot({ path: f.artifact('header-collapsed-menu.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /展开侧栏|Expand sidebar/, exact: true }).focus();
  await page.keyboard.press('Enter');
  await collapse.waitFor();
  await waitForSidebarWidth(240);

  // Keyboard creation keeps the draft on failure, disables while pending, then retries.
  await openWithKeyboard();
  await createItem().focus(); await page.keyboard.press('Enter');
  await nameInput().fill(longName);
  const failCreate = async route => route.request().postDataJSON()?.command === 'createWorkspace'
    ? route.fulfill({ status: 503, json: { error: 'Header fixture failure' } }) : route.fallback();
  await page.route('**/api/commands', failCreate);
  await nameInput().press('Enter');
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.equal(await nameInput().inputValue(), longName);
  assert(await submit().isEnabled());
  await page.unroute('**/api/commands', failCreate);
  let createStarted;
  const createReady = new Promise(resolve => { createStarted = resolve; });
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  const slowCreate = async route => {
    if (route.request().postDataJSON()?.command !== 'createWorkspace') return route.fallback();
    createStarted(); await createGate; await route.fallback();
  };
  await page.route('**/api/commands', slowCreate);
  await nameInput().press('Enter'); await createReady;
  assert(await submit().isDisabled()); assert(await nameInput().isDisabled()); assert(await trigger().isDisabled());
  releaseCreate();
  await page.waitForURL(url => url.searchParams.get('workspace') !== a.id);
  await trigger().waitFor(); await page.unroute('**/api/commands', slowCreate);
  const b = new URL(page.url()).searchParams.get('workspace');
  assert.equal(await trigger().getAttribute('title'), longName);
  assert((await trigger().innerText()).includes(longName));
  assert(await trigger().evaluate(el => el.scrollWidth <= el.clientWidth));
  const name = trigger().getByText(longName, { exact: true });
  assert(await name.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis'));
  await openWithKeyboard(); await assertMenuFits(1600);
  await page.screenshot({ path: f.artifact('header-long-name-light.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('table-theme', 'dark')); await page.reload();
  await trigger().waitFor(); await openWithKeyboard();
  await page.screenshot({ path: f.artifact('header-long-name-dark.png') });
  await page.keyboard.press('Escape');

  // A 320px rail uses the same mark and menu; switching remains keyboard operable.
  await page.setViewportSize({ width: 320, height: 720 });
  await waitForSidebarWidth(56);
  await openWithKeyboard(); await assertMenuFits(320);
  await page.screenshot({ path: f.artifact('header-mobile-menu-dark.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('table-theme', 'light')); await page.reload();
  await trigger().waitFor(); await openWithKeyboard(); await assertMenuFits(320);
  await page.screenshot({ path: f.artifact('header-mobile-menu-light.png') });
  let switchStarted;
  const switchReady = new Promise(resolve => { switchStarted = resolve; });
  const switchGate = new Promise(resolve => { releaseSwitch = resolve; });
  const slowSwitch = async route => {
    if (route.request().postDataJSON()?.command !== 'getWorkspace') return route.fallback();
    switchStarted(); await switchGate; await route.fallback();
  };
  await page.route('**/api/commands', slowSwitch);
  await page.getByRole('menuitem', { name: a.name, exact: true }).focus(); await page.keyboard.press('Enter');
  await switchReady; assert(await trigger().isDisabled());
  assert.equal(new URL(page.url()).searchParams.get('workspace'), b);
  releaseSwitch(); await page.waitForURL(url => url.searchParams.get('workspace') === a.id);
  await trigger().waitFor(); await page.unroute('**/api/commands', slowSwitch);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await sidebar().getByRole('link', { name: /对话|Chat/, exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/app', 'Home remains accessible through chat navigation');
  assert.deepEqual(f.errors, []);
  console.log('PASS: single Logo header, independent keyboard collapse/expand, collapsed menu, keyboard create/retry/loading/switch, long name, 320px, light/dark and home navigation');
} finally { releaseCreate(); releaseSwitch(); await f.close(); }
