import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
const f = await createBrowserFixture({ name: 'Member event dialogs' });
const { page, api, frontend } = f;
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const key = () => crypto.randomUUID();
const dialog = page.getByRole('dialog');
const view = async name => { await page.getByRole('combobox', { name: '日历视图', exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); await page.locator('.tabdo-booking-calendar[aria-busy="false"]').waitFor(); };
let release = () => {};
try {
  const agent = (await api('/members/agents', { name: '系统助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; f.users.push(agent.userId);
  await command('createAutomation', { name: '自动显示的计划', source: { kind: 'schedule', cron: '0 10 * * *', timeZone: 'UTC' }, trigger: { type: 'schedule_due' }, actions: [{ type: 'run_agent', agentUserId: agent.userId, prompt: 'Read only' }] });
  await page.goto(frontend + '/app/calendar');
  await page.locator('[data-schedule-point]').first().waitFor();
  assert.equal(await page.getByRole('switch').count(), 0, 'plans load without an opt-in switch');
  await page.getByRole('button', { name: '新建日历', exact: true }).first().click();
  await dialog.getByLabel('名称', { exact: true }).fill('成员事件日历');
  await dialog.getByLabel('IANA 时区', { exact: true }).fill('UTC');
  assert(await dialog.evaluate(el => Math.abs(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - innerWidth / 2) < 2), 'calendar creation is centered');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const calendar = (await command('listCalendars', {})).items[0];
  assert.equal((await command('listCalendarPeople', { calendarId: calendar.id })).items.length, 0, 'directory reads never create mappings');
  assert.equal(await page.getByRole('button', { name: '人员与排班', exact: true }).count(), 0);
  const newEvent = page.getByRole('button', { name: '新建事件', exact: true });
  await newEvent.click();
  await dialog.getByRole('heading', { name: '新建事件', exact: true }).waitFor();
  await dialog.getByRole('combobox', { name: '成员或智能体', exact: true }).click();
  await page.getByRole('option').filter({ hasText: agent.userId }).click();
  await dialog.getByLabel('事件标题', { exact: true }).fill('无需排班的智能体事件');
  await dialog.getByLabel('开始时间', { exact: true }).fill('02:00');
  // Failed save retains the exact draft and retry key, then a real delayed write blocks dismissal.
  const reject = async route => route.request().postDataJSON()?.command === 'createBooking' ? route.fulfill({ status: 503, json: { code: 'REQUEST_FAILED' } }) : route.fallback();
  await page.route('**/api/commands', reject);
  await dialog.getByRole('button', { name: '确认事件', exact: true }).click(); await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('事件标题', { exact: true }).inputValue(), '无需排班的智能体事件');
  await page.unroute('**/api/commands', reject);
  const gate = new Promise(resolve => { release = resolve; }); let intercepted; const hit = new Promise(resolve => { intercepted = resolve; });
  const delayed = async route => { if (route.request().postDataJSON()?.command === 'createBooking') { intercepted(); await gate; await route.fallback(); } else await route.fallback(); };
  await page.route('**/api/commands', delayed);
  await dialog.getByRole('button', { name: '确认事件', exact: true }).click(); await hit;
  await page.keyboard.press('Escape'); assert(await dialog.isVisible());
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert(await dialog.isVisible());
  release(); await dialog.waitFor({ state: 'hidden' }); await page.unroute('**/api/commands', delayed);
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('新建事件'));
  const people = (await command('listCalendarPeople', { calendarId: calendar.id })).items;
  assert.equal(people.length, 1); assert.equal(people[0].userId, agent.userId); assert.deepEqual(people[0].windows, []);
  const now = new Date(); const range = { rangeStart: new Date(+now - 2 * 86400000).toISOString(), rangeEnd: new Date(+now + 2 * 86400000).toISOString() };
  const booking = (await command('queryBookings', { calendarId: calendar.id, ...range })).items[0]; assert(booking); assert.equal(booking.userId, agent.userId); assert.equal(booking.schedulingMode, 'member');
  // Clicking a month blank date creates exactly one dialog with that date at 09:00.
  const cell = page.locator('[role=cell][data-date]').filter({ hasNot: page.locator('[data-booking-id], [data-schedule-point]') }).first();
  const date = await cell.getAttribute('data-date'); await cell.click({ position: { x: 20, y: 45 } });
  await dialog.getByRole('heading', { name: '新建事件', exact: true }).waitFor(); assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await dialog.getByLabel('开始时间', { exact: true }).inputValue(), '09:00');
  assert(await dialog.getByRole('button').filter({ hasText: new RegExp(String(Number(date.slice(-2)))) }).count());
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  // Week and day blank slots both work with a single click, without dragging.
  for (const name of ['周', '日']) {
    await view(name);
    const slot = page.locator('.tabdo-booking-calendar [data-time="11:00:00"]').last();
    await slot.scrollIntoViewIfNeeded(); const rect = await slot.boundingBox(); await page.mouse.click(rect.x + Math.min(60, rect.width / 2), rect.y + rect.height / 2);
    await dialog.getByRole('heading', { name: '新建事件', exact: true }).waitFor(); assert.equal(await dialog.getByLabel('开始时间', { exact: true }).inputValue(), '11:00');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  }
  await view('月');
  const plan = page.locator('[data-schedule-point]').first(); await plan.click();
  await dialog.getByRole('heading', { name: '定时计划', exact: true }).waitFor(); assert.equal(await dialog.getByLabel('事件标题', { exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await page.locator(`[data-booking-id="${booking.id}"]`).click();
  await dialog.getByLabel('事件标题', { exact: true }).fill('已编辑的成员事件');
  await dialog.getByRole('combobox', { name: '成员或智能体', exact: true }).click(); await page.getByRole('option').filter({ hasText: f.users[0] }).click();
  await dialog.getByRole('button', { name: '保存事件', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const edited = await command('getBooking', { calendarId: calendar.id, bookingId: booking.id }); assert.equal(edited.title, '已编辑的成员事件'); assert.equal(edited.userId, f.users[0]); assert.equal(edited.version, 2);
  // Both editors remain scrollable and fit the required narrow widths in either theme.
  for (const width of [390, 320]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    await newEvent.click(); await dialog.getByRole('heading', { name: '新建事件', exact: true }).waitFor();
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    await page.screenshot({ path: f.artifact(`member-dialog-${width}-${theme}.png`) });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '日历列表', exact: true }).click();
    await dialog.getByRole('button', { name: '新建日历', exact: true }).click();
    await dialog.getByRole('heading', { name: '新建日历', exact: true }).waitFor();
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: f.artifact(`calendar-dialog-${width}-${theme}.png`) }); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: `${calendar.name}的更多操作`, exact: true }).click(); await page.getByRole('menuitem', { name: '编辑日历', exact: true }).click();
  await dialog.getByLabel('名称', { exact: true }).fill('日历已编辑'); await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.equal((await command('getCalendar', { calendarId: calendar.id })).name, '日历已编辑');
  await page.locator(`[data-booking-id="${booking.id}"]`).click(); await dialog.getByRole('button', { name: '取消事件', exact: true }).click();
  const cancelledResponse = page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().postDataJSON()?.command === 'cancelBooking');
  await page.getByRole('alertdialog').getByRole('button', { name: '确认取消', exact: true }).click(); assert.equal((await cancelledResponse).status(), 200); await page.getByRole('alertdialog').waitFor({ state: 'hidden' }); await dialog.waitFor({ state: 'hidden' });
  assert.equal((await command('getBooking', { calendarId: calendar.id, bookingId: booking.id })).status, 'cancelled');
  await page.evaluate(() => localStorage.setItem('tabdo.locale', 'en')); await page.reload();
  await page.getByRole('button', { name: 'New event', exact: true }).click(); await dialog.getByRole('heading', { name: 'New event', exact: true }).waitFor();
  assert.deepEqual(f.errors, []);
  console.log('PASS: default plans, no-setup human/agent events, centered creation/edit dialogs, month/week/day blank clicks, no duplicate dialogs, retries/busy/ESC/focus, real edit/cancel, 320/390 light/dark, bilingual.');
} catch (error) { await page.screenshot({ path: f.artifact('calendar-management-failure.png') }); throw error; }
finally { release(); await f.close(); }
