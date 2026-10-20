import assert from 'node:assert/strict';
import { createBrowserFixture, postgres, databaseUrl } from './fixture.mjs';
const f = await createBrowserFixture({ name: '0046 combined Key grants' });
const { page, api, frontend } = f;
const db = postgres(databaseUrl);
const command = async (command, input) => (await api('/commands', { command, input })).result;
const key = () => crypto.randomUUID();
try {
  const table = await api('/tables', { name: 'Combined content' });
  const workspace = (await command('getWorkspace')).workspace;
  const calendar = await command('createCalendar', { name: 'Combined calendar', timeZone: 'UTC', idempotencyKey: key() });
  const plan = key();
  await db`insert into automations(id,workspace_id,organization_id,name,source,trigger,actions) values(${plan},${workspace.id},${f.organizations[0]},'Combined plan','{"kind":"schedule","cron":"0 10 * * *","timeZone":"UTC"}'::jsonb,'{"type":"schedule_due"}'::jsonb,'[]'::jsonb)`;
  let input = { name: 'Combined grants',
    permissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }],
    calendarPermissions: [{ calendarId: calendar.id, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, canTriggerAgent: true, canSubscribe: false, canReadDeliveries: false, canManageSubscriptions: false }],
    schedulePermissions: [{ automationId: plan, canRead: true, canUpdate: false }],
  };
  const saved = (await api('/user/api-keys', input)).key;
  await page.goto(frontend + '/app/settings?tab=api-keys');
  const panel = page.getByTestId('api-keys-settings'), dialog = page.getByRole('dialog');
  await panel.getByRole('button', { name: '编辑 Combined grants', exact: true }).click();
  assert.equal(await dialog.getByTestId(`table-access-${table.id}`).getByRole('checkbox').count(), 4);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const original = (await api('/user/api-keys')).keys.find(item => item.id === saved.id);
  for (const name of ['permissions', 'calendarPermissions', 'schedulePermissions']) assert.deepEqual(original[name], input[name]);
  const edits = [
    ['calendarPermissions', 'canSubscribe', `${workspace.name} / Combined calendar · 订阅事件`, true],
    ['calendarPermissions', 'canReadDeliveries', `${workspace.name} / Combined calendar · 读取投递记录`, true],
    ['calendarPermissions', 'canManageSubscriptions', `${workspace.name} / Combined calendar · 管理订阅`, true],
    ['schedulePermissions', 'canUpdate', `${workspace.name} / Combined plan · 修改计划`, true],
    ['calendarPermissions', 'canTriggerAgent', `${workspace.name} / Combined calendar · 触发智能体提醒`, false],
  ];
  for (const [family, operation, label, value] of edits) {
    await panel.getByRole('button', { name: '编辑 Combined grants', exact: true }).click();
    assert.equal(await dialog.getByRole('checkbox', { name: label, exact: true }).count(), 0, 'other resources start collapsed');
    await dialog.getByRole('button', { name: `${workspace.name}：日历与定时计划`, exact: true }).click();
    if (family === 'calendarPermissions') await dialog.getByRole('button', { name: /^日历：Combined calendar/ }).click();
    await dialog.getByRole('checkbox', { name: label, exact: true }).setChecked(value);
    input = { ...input, [family]: [{ ...input[family][0], [operation]: value }] };
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const actual = (await api('/user/api-keys')).keys.find(item => item.id === saved.id);
    for (const name of ['permissions', 'calendarPermissions', 'schedulePermissions']) assert.deepEqual(actual[name], input[name], `${family}.${operation} preserves ${name}`);
  }
  await panel.getByRole('button', { name: '编辑 Combined grants', exact: true }).click();
  await dialog.getByRole('checkbox', { name: `${workspace.name} / Combined content · 新增`, exact: true }).check();
  input = { ...input,
    permissions: [{ ...input.permissions[0], canCreate: true }],
  };
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const actual = (await api('/user/api-keys')).keys.find(item => item.id === saved.id);
  for (const name of ['permissions', 'calendarPermissions', 'schedulePermissions']) assert.deepEqual(actual[name], input[name]);
  assert(!("blogPermissions" in actual)); assert(!("documentPermissions" in actual));
  await page.setViewportSize({ width: 1100, height: 844 });
  await panel.getByRole('button', { name: '编辑 Combined grants', exact: true }).click();
  await dialog.getByRole('button', { name: `${workspace.name}：日历与定时计划`, exact: true }).click();
  await dialog.getByRole('button', { name: /^日历：Combined calendar/ }).click();
  for (const label of ['订阅事件', '读取投递记录', '管理订阅']) assert(await dialog.getByRole('checkbox', { name: `${workspace.name} / Combined calendar · ${label}`, exact: true }).isChecked());
  assert.equal(await dialog.getByRole('checkbox', { name: `${workspace.name} / Combined calendar · 触发智能体提醒`, exact: true }).isChecked(), false);
  assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: f.artifact('api-key-combined-grants-narrow.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(f.errors, []);
  console.log('PASS five-family Key browser: workspace resource edits preserve all grants; outbound bits and agent triggering stay independent; mobile persisted matrix.');
} finally { await db.end(); await f.close(); }
