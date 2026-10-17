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
  let input = { name: 'Five families',
    permissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false }],
    calendarPermissions: [{ calendarId: calendar.id, canRead: true, canReadAvailability: false, canCreate: false, canUpdate: false, canCancel: false, canManage: false, canTriggerAgent: true, canSubscribe: false, canReadDeliveries: false, canManageSubscriptions: false }],
    schedulePermissions: [{ automationId: plan, canRead: true, canUpdate: false }],
    documentPermissions: [{ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canReadHistory: false, canRestore: false, canUpload: false }],
    blogPermissions: [{ tableId: table.id, canRead: true, canConfigure: false, canBuild: false, canPublish: false, canRestore: false }],
  };
  const saved = (await api('/user/api-keys', input)).key;
  await page.goto(frontend + '/app/settings?tab=api-keys');
  const panel = page.getByTestId('api-keys-settings'), dialog = page.getByRole('dialog');
  const edits = [
    ['calendarPermissions', 'canSubscribe', 'Combined calendar · 订阅事件', true],
    ['calendarPermissions', 'canReadDeliveries', 'Combined calendar · 读取投递记录', true],
    ['calendarPermissions', 'canManageSubscriptions', 'Combined calendar · 管理订阅', true],
    ['blogPermissions', 'canBuild', 'Combined content · 构建与分享预览', true],
    ['documentPermissions', 'canReadHistory', 'Combined content · 读取历史', true],
    ['schedulePermissions', 'canUpdate', `${workspace.name} · Combined plan · 修改计划`, true],
    ['permissions', 'canCreate', `${workspace.name} / Combined content · 新增`, true],
    ['calendarPermissions', 'canTriggerAgent', 'Combined calendar · 触发智能体提醒', false],
  ];
  // Save/reopen for every edit so hidden families must survive the full UI/HTTP round trip.
  for (const [family, operation, label, value] of edits) {
    await panel.getByRole('button', { name: '编辑 Five families', exact: true }).click();
    await dialog.getByRole('checkbox', { name: label, exact: true }).setChecked(value);
    input = { ...input, [family]: [{ ...input[family][0], [operation]: value }] };
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const actual = (await api('/user/api-keys')).keys.find(item => item.id === saved.id);
    for (const name of ['permissions', 'calendarPermissions', 'schedulePermissions', 'documentPermissions', 'blogPermissions']) assert.deepEqual(actual[name], input[name], `${family}.${operation} preserves ${name}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: '编辑 Five families', exact: true }).click();
  for (const label of ['Combined calendar · 订阅事件', 'Combined calendar · 读取投递记录', 'Combined calendar · 管理订阅']) assert(await dialog.getByRole('checkbox', { name: label, exact: true }).isChecked());
  assert.equal(await dialog.getByRole('checkbox', { name: 'Combined calendar · 触发智能体提醒', exact: true }).isChecked(), false);
  assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await dialog.getByRole('checkbox', { name: 'Combined calendar · 订阅事件', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: f.artifact('api-key-five-families-mobile.png') });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(f.errors, []);
  console.log('PASS five-family Key browser: eight separate edits preserve all grants; outbound bits and agent triggering stay independent; mobile persisted matrix.');
} finally { await db.end(); await f.close(); }
