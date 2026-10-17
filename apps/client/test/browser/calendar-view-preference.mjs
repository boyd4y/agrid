import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Calendar view preference' });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
try {
  await api('/commands', { command: 'createCalendar', input: { name: '视图记忆日历', timeZone: 'UTC', idempotencyKey: crypto.randomUUID() } });
  await page.goto(frontend + '/app/calendar');
  const picker = page.getByRole('combobox', { name: '日历视图', exact: true });
  await picker.waitFor();
  await page.locator('.tabdo-booking-calendar[aria-busy="false"]').waitFor();
  assert.equal(await picker.innerText(), '月', 'a first desktop visit defaults to month');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('[aria-label="日历视图"]')?.textContent === '议程');
  assert.equal(await picker.innerText(), '议程', 'a first narrow visit defaults to agenda');
  // Choose through the real keyboard control, then revisit at the same width.
  await picker.focus(); await page.keyboard.press('Enter');
  await page.getByRole('option', { name: '日', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="日历视图"]')?.textContent === '日');
  assert.equal(await picker.innerText(), '日');
  assert.equal(await page.evaluate(() => localStorage.getItem('tabdo.calendar.view')), 'timeGridDay');
  await page.screenshot({ path: f.artifact('mobile-day-before-reload.png'), fullPage: false });
  await page.reload();
  await picker.waitFor();
  await page.locator('.tabdo-booking-calendar[aria-busy="false"]').waitFor();
  const observed = { selected: await picker.innerText(), stored: await page.evaluate(() => localStorage.getItem('tabdo.calendar.view')) };
  await writeFile(f.artifact('view-preference.json'), JSON.stringify(observed, null, 2));
  await page.screenshot({ path: f.artifact('mobile-after-reload.png'), fullPage: false });
  assert.equal(observed.selected, '日', 'a manual view selection survives reload on a narrow screen');
  assert.deepEqual(f.errors, []);
  console.log('PASS: first-visit desktop/mobile defaults and keyboard-selected mobile view survive reload.');
} catch (error) { await page.screenshot({ path: f.artifact('calendar-view-preference-failure.png'), fullPage: false }); throw error; }
finally { await f.close(); }
