import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Calendar management acceptance' });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const key = () => crypto.randomUUID();
const responseFor = (command, accepts = () => true) => page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === command && accepts(response.request().postDataJSON().input));

try {
  const calendar = await command('createCalendar', { name: '管理验收日历', timeZone: 'UTC', idempotencyKey: key() });
  const person = await command('createCalendarPerson', { calendarId: calendar.id, name: '管理验收医生', timeZone: 'UTC', idempotencyKey: key() });
  await command('setWorkingHours', { calendarId: calendar.id, personId: person.id, expectedVersion: 1, windows: [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, start: '09:00', end: '17:00' })), idempotencyKey: key() });
  await page.goto(frontend + '/app/calendar');
  await page.getByRole('button', { name: '人员与排班', exact: true }).waitFor();
  await page.getByRole('combobox', { name: '服务人员', exact: true }).click();
  await page.getByRole('option', { name: person.name, exact: true }).click();

  const month = responseFor('queryBookings', input => Date.parse(input.rangeEnd) - Date.parse(input.rangeStart) >= 28 * 86400000);
  await page.getByRole('radio', { name: '月', exact: true }).click();
  const monthInput = (await month).request().postDataJSON().input;
  assert(Date.parse(monthInput.rangeEnd) - Date.parse(monthInput.rangeStart) >= 28 * 86400000);
  assert.equal(await page.getByRole('radio', { name: '月', exact: true }).getAttribute('aria-checked'), 'true');
  await page.screenshot({ path: f.artifact('calendar-month.png'), fullPage: true });

  await page.getByRole('button', { name: '人员与排班', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('tab', { name: '临时休息', exact: true }).click();
  await sheet.getByLabel('开始时间', { exact: true }).fill('12:00');
  await sheet.getByLabel('结束时间', { exact: true }).fill('12:30');
  await sheet.getByRole('button', { name: '添加休息', exact: true }).click();
  const restRow = sheet.getByRole('listitem').filter({ hasText: '12:00–12:30' });
  await restRow.waitFor();
  const date = new Date().toISOString().slice(0, 10);
  let rest = (await command('listAvailabilityExceptions', { calendarId: calendar.id, personId: person.id, startDate: date, endDate: date })).items;
  assert.equal(rest.length, 1);
  const blocked = await command('checkBookingConflicts', { calendarId: calendar.id, personId: person.id, time: { start: `${date}T12:00:00Z`, end: `${date}T12:30:00Z`, timeZone: 'UTC' } });
  assert.equal(blocked.reason, 'OUTSIDE_AVAILABILITY');
  await restRow.getByRole('button', { name: '编辑', exact: true }).click();
  await sheet.getByLabel('结束时间', { exact: true }).fill('12:45');
  await sheet.getByRole('button', { name: '保存休息', exact: true }).click();
  const editedRow = sheet.getByRole('listitem').filter({ hasText: '12:00–12:45' });
  await editedRow.waitFor();
  rest = (await command('listAvailabilityExceptions', { calendarId: calendar.id, personId: person.id, startDate: date, endDate: date })).items;
  assert.equal(rest[0].version, 2);
  await page.screenshot({ path: f.artifact('calendar-time-off.png'), fullPage: true });
  await editedRow.getByRole('button', { name: '撤销休息', exact: true }).click();
  await editedRow.waitFor({ state: 'hidden' });
  assert.equal((await command('listAvailabilityExceptions', { calendarId: calendar.id, personId: person.id, startDate: date, endDate: date })).items.length, 0);
  assert((await command('checkBookingConflicts', { calendarId: calendar.id, personId: person.id, time: { start: `${date}T12:00:00Z`, end: `${date}T12:30:00Z`, timeZone: 'UTC' } })).available);
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });

  await page.getByRole('combobox', { name: '服务人员', exact: true }).click();
  await page.getByRole('option', { name: person.name, exact: true }).click();
  await page.getByRole('button', { name: '查未来7天空档', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /找到 \d+ 个可约时段/ }).waitFor();
  await page.getByRole('button', { name: /GMT/ }).first().click();
  await sheet.getByLabel('预约标题', { exact: true }).fill('UI空档预约');
  await sheet.getByRole('button', { name: '确认预约', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  const result = await command('queryBookings', { calendarId: calendar.id, rangeStart: new Date(Date.now() - 86400000).toISOString(), rangeEnd: new Date(Date.now() + 8 * 86400000).toISOString() });
  const booking = result.items.find(item => item.title === 'UI空档预约');
  assert(booking); assert.equal(booking.personId, person.id); assert.equal(Date.parse(booking.end) - Date.parse(booking.start), 30 * 60000);
  assert.deepEqual(f.errors, []);
  console.log('PASS: month range, UI time-off create/edit/remove and actual availability changes, person filter, seven-day slots and UI booking with correct person/duration.');
} catch (error) {
  await page.screenshot({ path: f.artifact('calendar-management-failure.png'), fullPage: true });
  throw error;
} finally { await f.close(); }
