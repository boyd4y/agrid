import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.STORYBOOK_URL;
const artifacts = process.env.BROWSER_ARTIFACT_DIR;
assert(origin && artifacts, 'Set STORYBOOK_URL and BROWSER_ARTIFACT_DIR');
await mkdir(artifacts, { recursive: true });
const index = (await (await fetch(origin + '/index.json')).json()).entries;
for (const name of ['default', 'disabled', 'localized', 'inside-form']) assert(index['ui-datarefreshbutton--' + name], `${name} indexed`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 600 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin + '/?path=/story/ui-datarefreshbutton--default');
  await page.getByRole('button', { name: 'DataRefreshButton', exact: true }).waitFor();
  await page.frameLocator('#storybook-preview-iframe').getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    for (const [story, label] of [['default', 'Refresh'], ['localized', '刷新']]) {
      await page.goto(`${origin}/iframe.html?id=ui-datarefreshbutton--${story}&viewMode=story&globals=theme:${theme}`);
      const refresh = page.getByRole('button', { name: label, exact: true }); await refresh.waitFor();
      await refresh.click();
      assert.equal(await page.getByLabel('Refresh count', { exact: true }).innerText(), 'Refreshes: 1');
      await page.screenshot({ path: `${artifacts}/refresh-${story}-${theme}.png` });
    }
  }
  await page.goto(origin + '/iframe.html?id=ui-datarefreshbutton--disabled&viewMode=story');
  const disabled = page.getByRole('button', { name: 'Refresh', exact: true }); await disabled.waitFor();
  assert(await disabled.isDisabled()); await disabled.evaluate(button => button.click());
  assert.equal(await page.getByLabel('Refresh count', { exact: true }).innerText(), 'Refreshes: 0');
  await page.goto(origin + '/iframe.html?id=ui-datarefreshbutton--inside-form&viewMode=story');
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true }); await refresh.waitFor();
  await refresh.click(); await refresh.press('Enter'); await refresh.press('Space');
  assert.equal(await page.getByLabel('Refresh count', { exact: true }).innerText(), '3');
  assert.equal(await page.getByLabel('Submit count', { exact: true }).innerText(), '0', 'refresh never submits the surrounding form');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  assert.equal(await page.getByLabel('Submit count', { exact: true }).innerText(), '1', 'the form can submit through its own action');
  assert.deepEqual(errors, []);
  console.log('PASS DataRefreshButton Storybook index/sidebar; English/Chinese light/dark callback; disabled; pointer/Enter/Space refresh without form submission');
} finally { await browser.close(); }
