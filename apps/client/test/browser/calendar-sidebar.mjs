import assert from 'node:assert/strict';
import { createBrowserFixture, postgres, databaseUrl } from './fixture.mjs';

const f = await createBrowserFixture({ name: 'Calendar sidebar acceptance' });
const { page, api, frontend } = f;
const db = postgres(databaseUrl);
page.setDefaultTimeout(15000);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const key = () => crypto.randomUUID();
const view = async name => { await page.getByRole('combobox', { name: '日历视图', exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); };
const more = name => page.getByRole('button', { name: `${name}的更多操作`, exact: true, includeHidden: true });
const bookingReads = [];
page.on('request', request => {
  if (request.method() === 'POST' && request.url().endsWith('/api/commands')) {
    const body = request.postDataJSON();
    if (body?.command === 'queryBookings') bookingReads.push(body.input);
  }
});
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
  for (const [index, userId] of [f.users[0], agent.userId].entries()) bookings.push(await command('createBooking', { calendarId: a.id, userId, title: `成员事件 ${index + 1}`, time: { start: `${date}T${17 + index}:00:00Z`, end: `${date}T${17 + index}:30:00Z`, timeZone: 'UTC' }, idempotencyKey: key() }));
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
  assert.equal(await page.getByRole('combobox').count(), 1, 'view is the only picker outside dialogs');
  assert.equal(await page.getByText('全部成员与智能体', { exact: true }).count(), 0);
  assert.equal(await toolbar.locator('..').getByText(a.name, { exact: true }).count(), 0, 'calendar name is not repeated above the events');
  assert.equal(await toolbar.evaluate(element => element.nextElementSibling?.classList.contains('tabdo-booking-calendar')), true, 'no secondary toolbar or blank row remains');
  await toolbar.getByText('协调世界时', { exact: true }).waitFor();
  assert.equal(await page.getByText('预测与已发生记录分开标记，不占事件时段', { exact: true }).count(), 0);
  const activeRow = page.getByRole('button', { name: a.name, exact: true, includeHidden: true });
  const activeMore = more(a.name);
  const rowBounds = await activeRow.locator('..').boundingBox(), moreBounds = await activeMore.boundingBox();
  assert(moreBounds.x >= rowBounds.x && moreBounds.x + moreBounds.width <= rowBounds.x + rowBounds.width, 'more button lies inside the selected surface');
  assert.notEqual(await activeRow.locator('..').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  await toolbar.hover(); await activeRow.blur();
  assert.equal(await activeMore.evaluate(element => getComputedStyle(element).opacity), '0');
  await activeRow.hover();
  assert.equal(await activeMore.evaluate(element => getComputedStyle(element).opacity), '1');
  await activeRow.focus(); await page.keyboard.press('Tab');
  assert(await activeMore.evaluate(element => element === document.activeElement), 'Tab reaches the independent more button');
  assert.equal(await activeMore.evaluate(element => getComputedStyle(element).opacity), '1');
  await page.keyboard.press('Enter'); await page.mouse.move(800, 80);
  await page.getByRole('menu').waitFor();
  assert.equal(await activeMore.evaluate(element => getComputedStyle(element).opacity), '1', 'open menu keeps its trigger visible');
  assert.equal(await activeRow.getAttribute('aria-current'), 'true');
  await page.keyboard.press('Escape');
  await page.locator('[data-schedule-point]').first().waitFor();
  const overflow = page.getByText(/还有\d+项/).first();
  await overflow.waitFor(); await overflow.click();
  await page.getByText('诊疗预约 6', { exact: true }).waitFor();
  for (const title of [...Array.from({ length: 6 }, (_, index) => `诊疗预约 ${index + 1}`), '成员事件 1', '成员事件 2']) await page.getByText(title, { exact: true }).last().waitFor();
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
  await more(a.name).focus(); await more(a.name).click(); await page.getByRole('menuitem', { name: '归档日历', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: '确认归档', exact: true }).click();
  await confirm.getByRole('alert').waitFor();
  assert.equal((await command('queryBookings', { calendarId: a.id, rangeStart: `${date}T00:00:00Z`, rangeEnd: `${date}T23:59:59Z` })).items.length, bookings.length);
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
  await toolbar.getByRole('status').waitFor();
  await page.getByRole('button', { name: '团队咨询改名', exact: true }).click(); release();
  await page.getByRole('button', { name: '新建事件', exact: true }).click();
  sheet = page.getByRole('dialog'); await sheet.getByRole('heading', { name: '新建事件', exact: true }).waitFor();
  assert.equal(await page.locator('[data-booking-id]').count(), 0);
  assert.match(await sheet.getByLabel('成员或智能体', { exact: true }).innerText(), /成员|智能体/, 'system members are available without staff configuration');
  await sheet.getByLabel('成员或智能体', { exact: true }).click();
  await page.getByRole('option', { name: `计划助手 · 智能体 · ${agent.userId}`, exact: true }).click();
  await sheet.getByLabel('事件标题', { exact: true }).fill('切换后的团队咨询');
  await sheet.getByRole('button', { name: '确认事件', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
  const afterSwitch = await command('queryBookings', { calendarId: b.id, rangeStart: new Date(Date.now() - 86400000).toISOString(), rangeEnd: new Date(Date.now() + 8 * 86400000).toISOString() });
  assert.equal(afterSwitch.items.length, 1); assert.equal(afterSwitch.items[0].title, '切换后的团队咨询'); assert.equal(afterSwitch.items[0].calendarId, b.id); assert.equal(afterSwitch.items[0].userId, agent.userId);
  await page.locator(`[data-booking-id="${afterSwitch.items[0].id}"]`).click();
  sheet = page.getByRole('dialog');
  assert.match(await sheet.getByLabel('成员或智能体', { exact: true }).innerText(), /计划助手/);
  await sheet.getByRole('button', { name: '关闭', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
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
  await page.locator('[data-schedule-point]').first().waitFor();
  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ language, theme }) => { localStorage.setItem('tabdo.locale', language); localStorage.setItem('table-theme', theme); }, { language, theme });
    await page.reload(); await page.getByRole('button', { name: a.name, exact: true }).click(); await page.locator('[data-booking-id]').first().waitFor();
    await page.locator('[data-schedule-point]').first().waitFor();
    await page.screenshot({ path: f.artifact(`month-desktop-${theme}-${language}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileView = page.getByRole('combobox', { name: 'Calendar view', exact: true });
  assert.equal(await mobileView.innerText(), 'Month', 'resizing preserves the manually selected month view');
  await mobileView.click(); await page.getByRole('option', { name: 'Agenda', exact: true }).click();
  const list = page.getByRole('button', { name: 'Calendars', exact: true });
  await list.click(); await page.getByRole('dialog').getByRole('button', { name: '团队咨询改名', exact: true }).click();
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === 'New event');
  assert.equal(await page.getByTestId('calendar-workspace').evaluate(element => element.scrollWidth > element.clientWidth), false);
  assert.equal(await page.getByRole('combobox', { name: 'Calendar view', exact: true }).innerText(), 'Agenda');
  await page.screenshot({ path: f.artifact('agenda-mobile-dark-en.png'), fullPage: false });
  await page.evaluate(() => { localStorage.setItem('table-theme', 'light'); localStorage.setItem('tabdo.locale', 'zh-CN'); }); await page.reload();
  await page.getByRole('combobox', { name: '日历视图', exact: true }).waitFor();
  await page.screenshot({ path: f.artifact('agenda-mobile-light-zh.png'), fullPage: false });
  for (const width of [320, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => localStorage.setItem('table-theme', theme), theme); await page.reload();
    await page.getByRole('button', { name: '日历列表', exact: true }).waitFor();
    await page.locator('.tabdo-booking-calendar[aria-busy="false"]').waitFor();
    assert.equal(await toolbar.evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.equal(await page.getByTestId('calendar-workspace').evaluate(element => element.scrollWidth > element.clientWidth), false);
    await page.screenshot({ path: f.artifact(`header-${width}-${theme}.png`), fullPage: false });
    await page.getByRole('button', { name: '日历列表', exact: true }).click();
    const mobileSidebar = page.getByRole('dialog').getByRole('navigation');
    assert.equal(await mobileSidebar.evaluate(element => element.scrollWidth > element.clientWidth), false);
    await more(a.name).focus(); await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: '编辑日历', exact: true }).waitFor();
    await page.screenshot({ path: f.artifact(`sidebar-${width}-${theme}.png`), fullPage: false });
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
  // A real touch context exercises the hover:none fallback and tap target.
  const touch = await f.browser.newContext({ storageState: await f.ctx.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const touchPage = await touch.newPage();
    await touchPage.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: f.base + url.pathname + url.search }); await route.fulfill({ response });
    });
    await touchPage.goto(frontend + '/app/calendar');
    await touchPage.getByRole('button', { name: '日历列表', exact: true }).tap();
    const selected = await touchPage.getByRole('button', { name: a.name, exact: true, includeHidden: true }).getAttribute('aria-current');
    const trigger = touchPage.getByRole('button', { name: `${a.name}的更多操作`, exact: true });
    assert(await touchPage.evaluate(() => matchMedia('(hover: none)').matches));
    assert.equal(await trigger.evaluate(element => getComputedStyle(element).opacity), '1');
    await trigger.tap(); await touchPage.getByRole('menuitem', { name: '编辑日历', exact: true }).waitFor();
    assert.equal(await touchPage.getByRole('button', { name: a.name, exact: true, includeHidden: true }).getAttribute('aria-current'), selected, 'tapping more does not select another calendar');
  } finally { await touch.close(); }
  // Regular members create direct events without gaining management permissions.
  await db`update member set role='member' where organization_id=${f.organizations[0]} and user_id=${f.users[0]}`;
  await page.reload(); await page.getByRole('button', { name: '日历列表', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /的更多操作$/ }).count(), 0);
  await page.getByRole('dialog').getByRole('button', { name: a.name, exact: true }).click();
  await page.getByRole('button', { name: '新建事件', exact: true }).click();
  sheet = page.getByRole('dialog'); await sheet.getByRole('heading', { name: '新建事件', exact: true }).waitFor();
  await sheet.getByLabel('成员或智能体', { exact: true }).click();
  await page.getByRole('option', { name: `Calendar sidebar acceptance · 成员 · ${f.users[0]}`, exact: true }).click();
  await sheet.getByLabel('事件标题', { exact: true }).fill('普通成员事件');
  await sheet.getByLabel('开始时间', { exact: true }).fill('03:00');
  await sheet.getByRole('button', { name: '确认事件', exact: true }).click(); await sheet.waitFor({ state: 'hidden' });
  const forbidden = await f.ctx.request.post(f.base + '/api/commands', { data: { command: 'createCalendarPerson', input: { calendarId: a.id, name: '无权人员', timeZone: 'UTC', idempotencyKey: key() } } });
  assert.equal(forbidden.status(), 403); assert.equal((await forbidden.json()).code, 'FORBIDDEN');
  assert(bookingReads.length > 0);
  for (const input of bookingReads) assert.deepEqual(Object.keys(input).sort(), ['calendarId', 'rangeEnd', 'rangeStart'], 'ordinary viewing always queries all calendar events');
  assert.deepEqual(f.errors, []);
  console.log('PASS: compact header without member filtering, all member/agent/legacy events, full-row sidebar selection and hover/keyboard/touch menus, 320/390 light/dark layout, sidebar target/focus, real edit/archive protection, stale reads, month overflow, remembered views, plans without staff, explicit read failure, bilingual themes/mobile, non-admin guidance and actual API denial.');
} catch (error) { await page.screenshot({ path: f.artifact('calendar-sidebar-failure.png'), fullPage: false }); throw error; }
finally { release(); await db.end(); await f.close(); }
