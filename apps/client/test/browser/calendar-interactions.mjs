import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createBrowserFixture } from './fixture.mjs';
const fixture = await createBrowserFixture({ name: 'Calendar drag and grants' });
const { page, api, frontend } = fixture;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const key = () => crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const time = (hour) => ({ start: `${today}T${hour}:00:00Z`, end: `${today}T${hour}:30:00Z`, timeZone: 'UTC' });
let releasePending = () => {};
const pointerGeometry = [];
try {
  const calendar = await command('createCalendar', { name: '交互预约日历', timeZone: 'UTC', idempotencyKey: key() });
  const person = await command('createCalendarPerson', { calendarId: calendar.id, name: '拖拽医生', timeZone: 'UTC', idempotencyKey: key() });
  await command('setWorkingHours', { calendarId: calendar.id, personId: person.id, expectedVersion: 1, windows: [1,2,3,4,5,6,7].map(day => ({ day, start: '09:00', end: '17:00' })), idempotencyKey: key() });
  const a = await command('createBooking', { calendarId: calendar.id, personId: person.id, title: '拖拽预约', time: time(10), idempotencyKey: key() });
  const b = await command('createBooking', { calendarId: calendar.id, personId: person.id, title: '冲突预约', time: time(11), idempotencyKey: key() });
  await page.goto(frontend + '/app/calendar');
  await page.getByRole('radio', { name: '日', exact: true }).click();
  const event = page.locator(`[data-booking-id="${a.id}"]`), blocker = page.locator(`[data-booking-id="${b.id}"]`);
  await event.waitFor(); await blocker.waitFor();
  const bounds = await event.boundingBox(), occupied = await blocker.boundingBox();
  const hourPixels = occupied.y - bounds.y;
  assert(hourPixels > 20);
  const drag = async (hours) => {
    // Raw mouse coordinates do not scroll the target into view. A refreshed
    // calendar mounts before its initial time-grid scroll has settled.
    await event.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await event.hover();
    const source = await event.boundingBox();
    const hit = await page.evaluate(({ x, y, distance }) => ({
      sourceId: document.elementFromPoint(x, y)?.closest('[data-booking-id]')?.getAttribute('data-booking-id'),
      targetInCalendar: !!document.elementFromPoint(x, y + distance)?.closest('.tabdo-booking-calendar'),
    }), { x: source.x + source.width / 2, y: source.y + Math.min(source.height / 2, 10), distance: hourPixels * hours });
    pointerGeometry.push({ hours, source, hit });
    assert.equal(hit.sourceId, a.id, 'the real pointer starts on the visible booking');
    assert(hit.targetInCalendar, 'the real pointer ends inside the visible calendar');
    await page.mouse.move(source.x + source.width / 2, source.y + Math.min(source.height / 2, 10));
    await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.move(source.x + source.width / 2, source.y + Math.min(source.height / 2, 10) + hourPixels * hours, { steps: 20 }); await page.waitForTimeout(100); await page.mouse.up();
  };
  const conflictResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'rescheduleBooking');
  void conflictResponse.catch(() => {});
  await drag(1);
  assert.equal((await conflictResponse).status(), 409);
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('alert').waitFor();
  assert.equal(await sheet.getByLabel('开始时间', { exact: true }).inputValue(), '11:00', 'failed drag preserves the attempted time in the keyboard form');
  assert.match((await command('getBooking', { calendarId: calendar.id, bookingId: a.id })).start, /T10:00:00/);
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'queryBookings');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await refreshed;
  await event.waitFor();
  const gate = new Promise(resolve => { releasePending = resolve; });
  const delayed = async route => {
    if (route.request().postDataJSON()?.command === 'rescheduleBooking') { await gate; await route.fallback(); } else await route.fallback();
  };
  await page.route('**/api/commands', delayed);
  const successResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'rescheduleBooking');
  void successResponse.catch(() => {});
  await drag(2);
  await page.waitForFunction(() => document.querySelector('.tabdo-booking-calendar')?.getAttribute('aria-busy') === 'true');
  releasePending(); assert.equal((await successResponse).status(), 200);
  await page.unroute('**/api/commands', delayed);
  await page.waitForFunction(() => document.querySelector('.tabdo-booking-calendar')?.getAttribute('aria-busy') === 'false');
  const moved = await command('getBooking', { calendarId: calendar.id, bookingId: a.id }); assert.match(moved.start, /T12:00:00/); assert.equal(moved.version, 2);
  // Resize with the actual pointer handle at the bottom edge, adding 30 minutes.
  const resizedResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'rescheduleBooking');
  void resizedResponse.catch(() => {});
  await event.hover(); const rect = await event.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 2 + hourPixels / 2, { steps: 15 }); await page.mouse.up();
  assert.equal((await resizedResponse).status(), 200);
  const resized = await command('getBooking', { calendarId: calendar.id, bookingId: a.id }); assert.match(resized.end, /T13:00:00/); assert.equal(resized.version, 3);
  // Add calendar grants while preserving the older per-table matrix.
  const table = await api('/tables', { name: '旧表授权' });
  await page.goto(frontend + '/app/settings?tab=api-keys');
  const settings = page.getByTestId('api-keys-settings');
  await settings.getByRole('button', { name: '创建 API Key', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称', { exact: true }).fill('日历授权测试');
  await dialog.getByRole('checkbox', { name: '交互预约日历 · 空档', exact: true }).check();
  const tableRead = dialog.getByRole('checkbox', { name: /旧表授权 · 读取$/ }); await tableRead.check();
  await dialog.getByRole('button', { name: '创建 API Key', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'API Key', exact: true }).waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await settings.getByRole('button', { name: '编辑 日历授权测试', exact: true }).click();
  assert(await dialog.getByRole('checkbox', { name: '交互预约日历 · 空档', exact: true }).isChecked());
  assert(await tableRead.isChecked());
  await dialog.getByRole('checkbox', { name: '交互预约日历 · 创建', exact: true }).check();
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const saved = (await api('/user/api-keys')).keys[0];
  assert.equal(saved.permissions[0].tableId, table.id); assert(saved.permissions[0].canRead);
  assert(saved.calendarPermissions[0].canReadAvailability && saved.calendarPermissions[0].canCreate); assert.equal(saved.calendarPermissions[0].canRead, false);
  assert.deepEqual(fixture.errors, []);
  console.log('PASS: real pointer drag conflict rollback with preserved form, pending feedback, successful drag/resize through versioned commands, calendar grants UI persists without dropping table grants.');
} catch (error) { await page.screenshot({ path: fixture.artifact('calendar-interactions-failure.png'), fullPage: true }); throw error; }
finally {
  releasePending();
  try { await writeFile(fixture.artifact('calendar-pointer-geometry.json'), JSON.stringify(pointerGeometry, null, 2)); }
  finally { await fixture.close(); }
}
