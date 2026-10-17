import assert from 'node:assert/strict';
import { createBrowserFixture, postgres, databaseUrl } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Calendar sidebar acceptance' });
const { page, api, frontend } = f;
const db = postgres(databaseUrl);
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const key = () => crypto.randomUUID();
const view = async name => { await page.getByRole('combobox', { name: '日历视图', exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); };
const more = name => page.getByRole('button', { name: `${name}的更多操作`, exact: true });
let release = () => {};
try {
  const a = await command('createCalendar', { name: '门诊日程', timeZone: 'UTC', idempotencyKey: key() });
  const b = await command('createCalendar', { name: '团队咨询', timeZone: 'Asia/Shanghai', idempotencyKey: key() });
  const person = await command('createCalendarPerson', { calendarId: a.id, name: '陈医生', timeZone: 'UTC', idempotencyKey: key() });
  await command('setWorkingHours', { calendarId: a.id, personId: person.id, expectedVersion: 1, windows: [1,2,3,4,5,6,7].map(day => ({ day, start: '00:00', end: '24:00' })), idempotencyKey: key() });
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const bookings = [];
  for (let index = 0; index < 6; index++) bookings.push(await command('createBooking', { calendarId: a.id, personId: person.id, title: `诊疗预约 ${index + 1}`, time: { start: `${date}T${10 + index}:00:00Z`, end: `${date}T${10 + index}:30:00Z`, timeZone: 'UTC' }, idempotencyKey: key() }));
  const agent = (await api('/members/agents', { name: '计划助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; f.users.push(agent.userId);
  await command('createAutomation', { name: '每日资料整理', source: { kind: 'schedule', cron: '0 10 * * *', timeZone: 'UTC' }, trigger: { type: 'schedule_due' }, actions: [{ type: 'run_agent', agentUserId: agent.userId, prompt: 'Read only' }] });
  await page.goto(frontend + '/app/calendar');
  await page.getByRole('button', { name: a.name, exact: true }).click();
  await page.locator(`[data-booking-id="${bookings[0].id}"]`).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '日历视图', exact: true }).innerText(), '月', 'first desktop visit uses month');
  const toolbar = page.getByTestId('calendar-toolbar');
  assert.equal(await toolbar.getByRole('button', { name: '新建日历', exact: true }).count(), 0);
  assert.equal(await toolbar.getByRole('button', { name: '归档日历', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '查未来7天空档', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '添加人员', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: a.name, exact: true }).getAttribute('aria-current'), 'true');
  await page.getByRole('switch', { name: '叠加定时计划', exact: true }).click();
  await page.locator('[data-schedule-point]').first().waitFor();
  const overflow = page.getByText(/还有\d+项/).first();
  await overflow.waitFor(); await overflow.click();
  await page.getByText('诊疗预约 6', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: f.artifact('month-overflow-light-zh.png'), fullPage: false });
  // Edit B from its row while A is active: the command must target B.
  await more(b.name).focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '编辑日历', exact: true }).click();
  let sheet = page.getByRole('dialog');
  assert.equal(await sheet.getByLabel('名称', { exact: true }).inputValue(), b.name);
  await sheet.getByLabel('名称', { exact: true }).fill('团队咨询改名');
  await sheet.getByRole('button', { name: '保存', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
  assert.equal((await command('getCalendar', { calendarId: b.id })).name, '团队咨询改名');
  assert.equal((await command('getCalendar', { calendarId: a.id })).name, a.name);
  await more('团队咨询改名').waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '团队咨询改名的更多操作');
  // The guarded archive is a real rejected command, preserving all bookings.
  await more(a.name).click(); await page.getByRole('menuitem', { name: '归档日历', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: '确认归档', exact: true }).click();
  await confirm.getByRole('alert').waitFor();
  assert.equal((await command('queryBookings', { calendarId: a.id, rangeStart: `${date}T00:00:00Z`, rangeEnd: `${date}T23:59:59Z` })).items.length, 6);
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  // Delay actual A reads; switching to B must never display A's bookings/person.
  let intercepted; const hit = new Promise(resolve => { intercepted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const delayed = async route => {
    const body = route.request().postDataJSON();
    if (body?.input?.calendarId === a.id && ['listCalendarPeople', 'queryBookings'].includes(body.command)) {
      const response = await route.fetch(); intercepted(); await gate;
      try { await route.fulfill({ response }); } catch { /* The browser cancels the old request on calendar switch. */ }
    } else await route.fallback();
  };
  await page.route('**/api/commands', delayed);
  await page.getByRole('button', { name: '刷新', exact: true }).click(); await hit;
  await page.getByRole('button', { name: '团队咨询改名', exact: true }).click(); release();
  await page.getByRole('button', { name: '新建预约', exact: true }).click();
  sheet = page.getByRole('dialog'); await sheet.getByRole('heading', { name: '新建预约', exact: true }).waitFor();
  assert.equal(await page.locator('[data-booking-id]').count(), 0);
  assert.equal(await sheet.getByLabel('服务人员', { exact: true }).innerText(), person.name, 'people retain their workspace identity across calendars');
  await sheet.getByLabel('预约标题', { exact: true }).fill('切换后的团队咨询');
  await sheet.getByRole('button', { name: '选择可约时间', exact: true }).click();
  await sheet.getByRole('button', { name: '查未来7天空档', exact: true }).click();
  await sheet.getByRole('button', { name: /GMT/ }).first().click();
  await sheet.getByRole('button', { name: '确认预约', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
  const afterSwitch = await command('queryBookings', { calendarId: b.id, rangeStart: new Date(Date.now() - 86400000).toISOString(), rangeEnd: new Date(Date.now() + 8 * 86400000).toISOString() });
  assert.equal(afterSwitch.items.length, 1); assert.equal(afterSwitch.items[0].title, '切换后的团队咨询'); assert.equal(afterSwitch.items[0].calendarId, b.id);
  await page.unroute('**/api/commands', delayed);
  await page.locator('[data-schedule-point]').first().waitFor();
  await page.getByRole('button', { name: a.name, exact: true }).click();
  await page.locator(`[data-booking-id="${bookings[0].id}"]`).waitFor();
  await view('周'); await page.reload(); await page.getByRole('button', { name: a.name, exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '日历视图', exact: true }).innerText(), '周', 'manual view persists across reload');
  await view('月');
  // QUERY_LIMIT stays an explicit failure; retry fetches the real command again.
  const fail = async route => route.request().postDataJSON()?.command === 'queryBookings' ? route.fulfill({ status: 422, json: { code: 'QUERY_LIMIT' } }) : route.fallback();
  await page.route('**/api/commands', fail); await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('查询超出上限，请缩小日期范围或选择更少的计划。', { exact: true }).waitFor();
  await page.unroute('**/api/commands', fail); await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator(`[data-booking-id="${bookings[0].id}"]`).waitFor();
  await page.getByRole('switch', { name: '叠加定时计划', exact: true }).click();
  await page.locator('[data-schedule-point]').first().waitFor();
  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ language, theme }) => { localStorage.setItem('tabdo.locale', language); localStorage.setItem('table-theme', theme); }, { language, theme });
    await page.reload(); await page.getByRole('button', { name: a.name, exact: true }).click(); await page.locator('[data-booking-id]').first().waitFor();
    // Plans are opt-in per page session.
    await page.getByRole('switch').click(); await page.locator('[data-schedule-point]').first().waitFor();
    await page.screenshot({ path: f.artifact(`month-desktop-${theme}-${language}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const list = page.getByRole('button', { name: 'Calendars', exact: true });
  await list.click(); await page.getByRole('dialog').getByRole('button', { name: '团队咨询改名', exact: true }).click();
  await page.getByRole('button', { name: 'New appointment', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'New appointment');
  assert.equal(await page.getByTestId('calendar-workspace').evaluate(element => element.scrollWidth > element.clientWidth), false);
  assert.equal(await page.getByRole('combobox', { name: 'Calendar view', exact: true }).innerText(), 'Agenda');
  await page.screenshot({ path: f.artifact('agenda-mobile-dark-en.png'), fullPage: false });
  await page.evaluate(() => { localStorage.setItem('table-theme', 'light'); localStorage.setItem('tabdo.locale', 'zh-CN'); }); await page.reload();
  await page.getByRole('combobox', { name: '日历视图', exact: true }).waitFor();
  await page.screenshot({ path: f.artifact('agenda-mobile-light-zh.png'), fullPage: false });
  // No-staff guidance uses a second owned workspace; staff are shared within each workspace.
  const emptyOrg = await api('/auth/organization/create', { name: '无人员工作区', slug: 'browser-' + key() }); f.organizations.push(emptyOrg.id);
  await api('/auth/organization/set-active', { organizationId: emptyOrg.id });
  const emptyCalendar = await command('createCalendar', { name: '尚未排班', timeZone: 'UTC', idempotencyKey: key() });
  const emptyAgent = (await api('/members/agents', { name: '无排班计划助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; f.users.push(emptyAgent.userId);
  await command('createAutomation', { name: '无需人员的定时计划', source: { kind: 'schedule', cron: '0 10 * * *', timeZone: 'UTC' }, trigger: { type: 'schedule_due' }, actions: [{ type: 'run_agent', agentUserId: emptyAgent.userId, prompt: 'Read only' }] });
  await page.goto(frontend + '/app/calendar'); await page.getByRole('button', { name: '日历列表', exact: true }).click();
  await page.getByRole('switch', { name: '叠加定时计划', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('[data-schedule-point]').first().waitFor();
  await page.getByRole('button', { name: '新建预约', exact: true }).click();
  sheet = page.getByRole('dialog'); await sheet.getByRole('heading', { name: '设置预约排班', exact: true }).waitFor();
  await sheet.getByRole('button', { name: '添加人员', exact: true }).click();
  await sheet.getByRole('heading', { name: '人员与排班 · 尚未排班', exact: true }).waitFor();
  await sheet.getByRole('button', { name: '关闭', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
  // A regular member sees a concrete next step and receives no management permission.
  await db`update member set role='member' where organization_id=${emptyOrg.id} and user_id=${f.users[0]}`;
  await page.reload(); await page.getByRole('button', { name: '日历列表', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /的更多操作$/ }).count(), 0);
  await page.getByRole('dialog').getByRole('button', { name: '尚未排班', exact: true }).click();
  await page.getByRole('button', { name: '新建预约', exact: true }).click();
  sheet = page.getByRole('dialog'); await sheet.getByText(/请联系工作区管理员/).waitFor();
  assert.equal(await sheet.getByRole('button', { name: '添加人员', exact: true }).count(), 0);
  const forbidden = await f.ctx.request.post(f.base + '/api/commands', { data: { command: 'createCalendarPerson', input: { calendarId: emptyCalendar.id, name: '无权人员', timeZone: 'UTC', idempotencyKey: key() } } });
  assert.equal(forbidden.status(), 403); assert.equal((await forbidden.json()).code, 'FORBIDDEN');
  assert.equal((await command('listCalendarPeople', { calendarId: emptyCalendar.id })).items.length, 0);
  assert.deepEqual(f.errors, []);
  console.log('PASS: sidebar target/focus, real edit/archive protection, stale reads, month overflow, remembered views, plans without staff, explicit read failure, bilingual themes/mobile, non-admin guidance and actual API denial.');
} catch (error) { await page.screenshot({ path: f.artifact('calendar-sidebar-failure.png'), fullPage: false }); throw error; }
finally { release(); await db.end(); await f.close(); }
