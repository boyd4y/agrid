import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.STORYBOOK_URL;
const artifacts = process.env.BROWSER_ARTIFACT_DIR;
assert(origin && artifacts, 'Set STORYBOOK_URL and BROWSER_ARTIFACT_DIR');
await mkdir(artifacts, { recursive: true });
const index = (await (await fetch(origin + '/index.json')).json()).entries;
for (const name of ['default', 'disabled', 'controlled', 'localized']) assert(index['ui-searchinput--' + name], `${name} indexed`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 600 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin + '/?path=/story/ui-searchinput--default');
  await page.getByRole('button', { name: 'SearchInput', exact: true }).waitFor();
  await page.frameLocator('#storybook-preview-iframe').getByRole('textbox', { name: 'Search tables', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    for (const [story, label] of [['default', 'Search tables'], ['localized', '搜索表格']]) {
      await page.goto(`${origin}/iframe.html?id=ui-searchinput--${story}&viewMode=story&globals=theme:${theme}`);
      const search = page.getByRole('textbox', { name: label, exact: true }); await search.waitFor();
      assert.equal(await search.getAttribute('placeholder'), label);
      await search.fill('Alpha 表格'); assert.equal(await search.inputValue(), 'Alpha 表格');
      assert(await search.evaluate(input => document.activeElement === input));
      assert.equal(await search.locator('..').locator('svg[aria-hidden=true]').count(), 1);
      await page.screenshot({ path: `${artifacts}/search-${story}-${theme}.png` });
      await search.fill(''); assert.equal(await search.inputValue(), '');
    }
  }
  await page.goto(origin + '/iframe.html?id=ui-searchinput--disabled&viewMode=story');
  const disabled = page.getByRole('textbox', { name: 'Search tables', exact: true }); await disabled.waitFor();
  assert(await disabled.isDisabled());
  await page.goto(origin + '/iframe.html?id=ui-searchinput--controlled&viewMode=story');
  const search = page.getByRole('textbox', { name: 'Search tables', exact: true }); await search.waitFor();
  await search.fill('受控输入');
  assert.equal(await page.getByLabel('Search value', { exact: true }).innerText(), '受控输入');
  await page.getByRole('button', { name: 'Clear and focus', exact: true }).click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await page.getByLabel('Search value', { exact: true }).innerText(), '');
  assert(await search.evaluate(input => document.activeElement === input), 'ref points to the standard Input element');
  assert.deepEqual(errors, []);
  console.log('PASS SearchInput Storybook index/sidebar; English/Chinese light/dark label/placeholder/edit/clear; decorative icon; disabled; controlled value/onChange and ref focus');
} finally { await browser.close(); }
