import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Mount the actual six hosts with observable callbacks; no API/database writes.
const frontend = process.env.BROWSER_BASE_URL ?? 'http://localhost:5173';
const artifactDir = process.env.BROWSER_ARTIFACT_DIR ?? new URL('../artifacts/field-options/', import.meta.url).pathname;
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : process.env.BROWSER_CHANNEL === 'bundled' ? {} : { channel: process.env.BROWSER_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.setDefaultTimeout(10000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url()); });
await page.route('**/__field-options-fixture?*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
await import('/test/browser/helpers/field-options-fixture.tsx');
</script></body></html>` }));
const load = async (host, type, extra = {}) => {
  await page.goto(`${frontend}/__field-options-fixture?${new URLSearchParams({ host, type, ...extra })}`);
  await page.getByTestId('host').waitFor();
  if (host === 'cell') await page.getByRole('dialog').waitFor();
};
const events = () => page.getByTestId('events').evaluate(el => JSON.parse(el.textContent));
const value = () => page.getByTestId('value').evaluate(el => JSON.parse(el.textContent));
const dialog = page.getByRole('dialog');
const outside = () => page.getByTestId('outside').click();
const formOpen = () => page.getByTestId('host').getByRole('button').click();
const option = label => dialog.getByRole('button', { name: label, exact: true });
try {
  // Cell keyboard focus, wrapping, filtering, clear, cancellation and stable IDs.
  await load('cell', 'select');
  assert(await dialog.getByRole('textbox').evaluate(el => el === document.activeElement));
  await page.keyboard.press('ArrowUp'); assert(await option('Option 39').evaluate(el => el === document.activeElement));
  assert(await option('Option 39').evaluate(el => el.parentElement.scrollTop > 0), 'keyboard scrolls the long cell list');
  await page.keyboard.press('ArrowDown'); assert(await option('Option 00').evaluate(el => el === document.activeElement));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.deepEqual(await events(), [{ kind: 'commit', value: 'stable-1' }]);
  await load('cell', 'select');
  await page.keyboard.press('Tab'); assert(await dialog.getByRole('button', { name: 'Clear selection', exact: true }).evaluate(el => el === document.activeElement));
  await page.keyboard.press('Enter'); assert.deepEqual(await events(), [{ kind: 'commit', value: null }]);
  await load('cell', 'select'); await dialog.getByRole('textbox').fill('  Option 39  ');
  assert.equal(await dialog.locator('[data-cell-option]').count(), 1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); assert.equal(await value(), 'stable-39');
  await load('cell', 'select', { empty: '1', blank: '1' });
  assert.equal(await dialog.locator('[data-cell-option]').count(), 0);
  assert(await dialog.getByRole('button', { name: 'Clear selection', exact: true }).isDisabled());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); assert.deepEqual(await events(), [{ kind: 'cancel' }]);
  await load('cell', 'select'); await outside(); assert.deepEqual(await events(), [{ kind: 'cancel' }]);

  // Multi-select has no eager commit; Escape/outside each commit exactly once.
  for (const close of ['Escape', 'outside']) {
    await load('cell', 'multi_select'); await option('Option 01').click();
    assert.deepEqual(await events(), []); assert(await dialog.isVisible());
    if (close === 'Escape') await page.keyboard.press('Escape'); else await outside();
    assert.deepEqual(await events(), [{ kind: 'commit', value: ['stable-0', 'stable-1'] }]);
  }
  await load('cell', 'multi_select'); await page.keyboard.press('Escape'); assert.deepEqual(await events(), [{ kind: 'cancel' }]);
  await load('cell', 'multi_select'); await dialog.getByRole('button', { name: 'Clear selection', exact: true }).click();
  assert.deepEqual(await events(), []); await page.keyboard.press('Escape'); assert.deepEqual(await events(), [{ kind: 'commit', value: [] }]);
  await load('cell', 'multi_select'); await dialog.getByRole('button', { name: 'Remove Option 00', exact: true }).click();
  await dialog.getByRole('textbox').fill('does-not-exist'); assert.equal(await dialog.locator('[data-cell-option]').count(), 0);
  await page.keyboard.press('Escape'); assert.deepEqual(await events(), [{ kind: 'commit', value: [] }]);

  // Legacy person names resolve, email filtering commits userId, empty members allow free text only in cell.
  await load('cell', 'person'); assert.equal(await dialog.locator('[data-cell-option]').filter({ has: page.getByText('Ada', { exact: true }) }).getAttribute('aria-pressed'), 'true');
  await dialog.getByRole('textbox').fill('assistant@'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.deepEqual(await events(), [{ kind: 'commit', value: 'user-agent' }]);
  await load('cell', 'person', { empty: '1' });
  await dialog.getByRole('textbox').last().fill('Historical name'); await dialog.getByRole('textbox').last().press('Enter');
  assert.deepEqual(await events(), [{ kind: 'commit', value: 'Historical name' }]);

  // Form drafts: no search added to select/multi; single closes, multi stays open, focus returns on Escape.
  for (const variant of ['default', 'typeform']) {
    await load('form', 'select', { variant }); assert.equal(await dialog.count(), 0); await formOpen();
    assert.equal(await dialog.getByRole('textbox').count(), 0); await option('Option 01').focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await events(), [{ kind: 'change', value: 'stable-1' }]); await dialog.waitFor({ state: 'hidden' });
    await formOpen(); await option('Clear').click(); assert.equal(await value(), null);
    await load('form', 'multi_select', { variant }); await formOpen(); await option('Option 01').click();
    assert(await dialog.isVisible()); assert.equal(await dialog.getByRole('textbox').count(), 0);
    assert.deepEqual(await events(), [{ kind: 'change', value: ['stable-0', 'stable-1'] }]);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('[data-testid="host"] button') === document.activeElement);
    assert.equal((await events()).length, 1, 'form dismiss does not submit another change');
    await load('form', 'person', { variant }); assert(await page.getByTestId('host').getByText('Ada', { exact: true }).isVisible());
    await formOpen(); await dialog.getByRole('textbox').fill('assistant@'); await option('Agent').click();
    assert.deepEqual(await events(), [{ kind: 'change', value: 'user-agent' }]); await dialog.waitFor({ state: 'hidden' });
    await formOpen(); await option('Clear').click(); assert.equal(await value(), null);
    await load('form', 'select', { variant, empty: '1', blank: '1' }); await formOpen();
    assert.equal(await dialog.getByRole('button').count(), 1); await page.keyboard.press('Escape'); assert.deepEqual(await events(), []);
    for (const type of ['select', 'multi_select']) {
      await load('form', type, { variant, buttons: '1' }); assert.equal(await dialog.count(), 0);
      await page.getByTestId('host').getByRole('button', { name: 'Option 01', exact: true }).click();
      assert.deepEqual(await events(), [{ kind: 'change', value: type === 'select' ? 'stable-1' : ['stable-0', 'stable-1'] }]);
    }
  }

  // One visual capture batch across six hosts, both languages/themes and typeform treatment.
  for (const lang of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
    for (const host of ['cell', 'form']) for (const type of ['select', 'multi_select', 'person']) {
      await load(host, type, { lang, theme }); if (host === 'form') await formOpen();
      await page.mouse.move(900, 700);
      await page.screenshot({ animations: 'disabled', path: join(artifactDir, `${host}-${type}-${lang}-${theme}.png`) });
    }
    for (const type of ['select', 'multi_select']) {
      await load('form', type, { lang, theme, variant: 'typeform' }); await formOpen();
      await page.mouse.move(900, 700);
      await page.screenshot({ animations: 'disabled', path: join(artifactDir, `typeform-${type}-${lang}-${theme}.png`) });
    }
  }
  assert.deepEqual(writes, [], 'field hosts only invoke local callbacks, never server writes');
  assert.deepEqual(errors, []);
  console.log('PASS six field hosts: keyboard/Tab/Escape/outside; stable IDs; single clear/empty; multi exactly-once close and remove; person historical name/email/userId/free text; form local draft/close/focus/buttons/default/typeform; 32 en/zh light/dark captures; no API writes');
} catch (error) {
  await page.screenshot({ path: join(artifactDir, 'field-options-failure.png') }).catch(() => {});
  throw error;
} finally { await browser.close(); }
