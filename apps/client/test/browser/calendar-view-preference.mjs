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
  assert.equal(await page.evaluate(() => localStorage.getItem('tabdo.calendar.view')), null, 'automatic defaults are not saved as a preference');
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

  const expectView = async (label) => {
    await page.waitForFunction((expected) => document.querySelector('[aria-label="日历视图"]')?.textContent === expected, label);
    assert.equal(await picker.innerText(), label);
  };
  const chooseView = async (label) => {
    await picker.focus(); await page.keyboard.press('Enter');
    await page.getByRole('option', { name: label, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expectView(label);
  };
  const expectRange = async (days, action) => {
    const queried = page.waitForResponse(response => {
      if (!response.url().endsWith('/api/commands') || response.request().method() !== 'POST') return false;
      const body = response.request().postDataJSON();
      return body.command === 'queryBookings' && Date.parse(body.input.rangeEnd) - Date.parse(body.input.rangeStart) === days * 86400000;
    });
    await action();
    assert((await queried).ok(), 'the rendered view queries its actual date range');
    await page.locator('.tabdo-booking-calendar[aria-busy="false"]').waitFor();
  };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expectView('日');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectView('日');
  await expectRange(7, () => chooseView('周'));
  await expectRange(7, () => page.reload());
  await expectView('周');
  assert.equal(await page.evaluate(() => localStorage.getItem('tabdo.calendar.view')), 'timeGridWeek');

  // Corrupt/obsolete preferences fall back to responsive defaults without being rewritten.
  await page.evaluate(() => localStorage.setItem('tabdo.calendar.view', 'obsoleteView'));
  await expectRange(7, () => page.reload());
  await expectView('议程');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expectView('月');
  await expectRange(7, () => page.setViewportSize({ width: 390, height: 844 }));
  await expectView('议程');
  assert.equal(await page.evaluate(() => localStorage.getItem('tabdo.calendar.view')), 'obsoleteView');

  // A browser that denies storage still keeps the user's choice for the mounted page.
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        if (key === 'tabdo.calendar.view') throw new DOMException('Storage unavailable', 'SecurityError');
        return original.call(this, key, ...args);
      };
    }
  });
  await expectRange(7, () => page.reload());
  await expectView('议程');
  await expectRange(1, () => chooseView('日'));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expectView('日');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectView('日');
  await expectRange(7, () => page.reload());
  await expectView('议程');
  assert.deepEqual(f.errors, []);
  console.log('PASS: responsive defaults, keyboard-selected view reload/resize, actual date ranges, invalid preferences and unavailable storage.');
} catch (error) { await page.screenshot({ path: f.artifact('calendar-view-preference-failure.png'), fullPage: false }); throw error; }
finally { await f.close(); }
