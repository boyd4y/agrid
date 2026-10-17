import assert from 'node:assert/strict';
import { createBrowserFixture } from './fixture.mjs';
let calendarId, personId, queryRange;
let calls = 0;
const requests = [];
const fixture = await createBrowserFixture({ name: 'Calendar booking browser', modelRequest: async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw); requests.push(input); calls++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'calendar-browser', object: 'chat.completion.chunk', created: 1, model: 'fixture/model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: 'assistant' });
  if (calls === 1) {
    send({ tool_calls: [{ index: 0, id: 'calendar-availability', type: 'function', function: { name: 'query_availability', arguments: JSON.stringify({ calendarId, personId, ...queryRange, durationMinutes: 30 }) } }] }); send({}, 'tool_calls');
  } else if (calls === 2) {
    const tool = input.messages.find(message => message.role === 'tool');
    const value = typeof tool?.content === 'string' ? tool.content : JSON.stringify(tool?.content);
    const start = /"start"\s*:\s*"([^"]+)"/.exec(value)?.[1];
    assert(start, 'real availability tool returns a slot');
    send({ tool_calls: [{ index: 0, id: 'calendar-book', type: 'function', function: { name: 'create_booking', arguments: JSON.stringify({ calendarId, personId, title: '智能体牙医预约', time: { start, end: new Date(Date.parse(start) + 1800000).toISOString(), timeZone: 'UTC' }, idempotencyKey: 'browser-native-calendar-booking' }) } }] }); send({}, 'tool_calls');
  } else { send({ content: '牙医预约已确认。' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
} });
const { page, api, frontend, ctx, base } = fixture;
const command = async (command, input) => (await api('/commands', { command, input })).result;
try {
  await page.goto(frontend + '/app/calendar');
  await page.getByRole('heading', { name: '安排一次预约', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建日历', exact: true }).first().click();
  let sheet = page.getByRole('dialog');
  await sheet.getByLabel('名称', { exact: true }).fill('牙医预约');
  await sheet.getByLabel('IANA 时区', { exact: true }).fill('UTC');
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '添加人员', exact: true }).click();
  sheet = page.getByRole('dialog');
  await sheet.getByLabel('名称', { exact: true }).fill('陈医生');
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await sheet.getByRole('tab', { name: '工作时间', exact: true }).click();
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  for (const day of days) {
    await sheet.getByRole('button', { name: '添加工作时段', exact: true }).click();
    await sheet.getByRole('combobox', { name: '星期', exact: true }).last().click();
    await page.getByRole('option', { name: day, exact: true }).click();
  }
  await sheet.getByRole('button', { name: '保存工作时间', exact: true }).click();
  await sheet.getByRole('button', { name: '保存工作时间', exact: true }).waitFor({ state: 'visible' });
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  calendarId = (await command('listCalendars', {})).items[0].id;
  const people = await command('listCalendarPeople', { calendarId }); personId = people.items[0].id;
  assert.equal(people.items[0].windows.length, 7);
  queryRange = { rangeStart: new Date(Date.now() + 86400000).toISOString(), rangeEnd: new Date(Date.now() + 7 * 86400000).toISOString() };
  const agent = (await api('/members/agents', { name: '预约助手', persona: { defaultHarness: 'pi', defaultModel: 'fixture/model', runtime: 'local' } })).member; fixture.users.push(agent.userId);
  const thread = await api('/threads', { clientId: crypto.randomUUID(), context: { page: 'ai' }, agentId: agent.id });
  const response = await ctx.request.post(base + '/api/chat', { data: { id: thread.id, agentId: agent.id, context: { page: 'ai' }, messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: '查陈医生未来7天空档并预约30分钟。' }] }] } });
  assert(response.ok(), await response.text());
  assert.match(await response.text(), /牙医预约已确认/);
  assert.equal(calls, 3);
  assert(requests[0].tools.some(tool => tool.function.name === 'query_availability'));
  const query = { calendarId, rangeStart: new Date(Date.now() - 86400000).toISOString(), rangeEnd: new Date(Date.now() + 9 * 86400000).toISOString() };
  const booking = (await command('queryBookings', query)).items[0]; assert(booking); assert.equal(booking.title, '智能体牙医预约');
  // Display the actual native-tool booking in the page's fetched range.
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('radio', { name: '议程', exact: true }).click();
  const event = page.locator('.tabdo-booking-calendar').getByText(/智能体牙医预约/).first();
  if (!await event.count()) await page.getByRole('button', { name: '下一时段', exact: true }).click();
  await event.waitFor(); await event.click();
  sheet = page.getByRole('dialog');
  await sheet.getByLabel('开始时间', { exact: true }).fill('15:00');
  await sheet.getByRole('button', { name: '保存改期', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  let moved = await command('getBooking', { calendarId, bookingId: booking.id });
  assert.equal(moved.version, 2); assert.match(moved.start, /T15:00:00/);
  await event.waitFor(); await event.click();
  await page.getByRole('dialog').getByRole('button', { name: '取消预约', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: '确认取消', exact: true }).click();
  await confirm.waitFor({ state: 'hidden' });
  const cancelled = await command('getBooking', { calendarId, bookingId: booking.id }); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.revision, 3);
  assert.equal((await command('checkBookingConflicts', { calendarId, personId, time: { start: moved.start, end: moved.end, timeZone: 'UTC' } })).available, true);
  await page.screenshot({ path: fixture.artifact('calendar-light.png'), fullPage: true });
  await page.evaluate(() => { localStorage.setItem('table-theme', 'dark'); }); await page.reload();
  await page.getByTestId('calendar-workspace').waitFor();
  await page.screenshot({ path: fixture.artifact('calendar-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('[data-testid=app-sidebar]')?.getBoundingClientRect().width <= 60);
  await page.getByRole('radio', { name: '议程', exact: true }).waitFor();
  assert.equal(await page.getByTestId('calendar-workspace').evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.screenshot({ path: fixture.artifact('calendar-narrow.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('tabdo.locale', 'en')); await page.reload();
  await page.getByRole('heading', { name: 'Calendar', exact: true }).waitFor();
  assert.deepEqual(fixture.errors, []);
  console.log('PASS: UI creates calendar/person/weekly hours → actual native Pi tools query availability and book → UI reschedules/cancels → DB verifies revision and released slot; React 19, Chinese/English, light/dark/narrow.');
} catch (error) { await page.screenshot({ path: fixture.artifact("calendar-failure.png"), fullPage: true }); throw error; } finally { await fixture.close(); }
