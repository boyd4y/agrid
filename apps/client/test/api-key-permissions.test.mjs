import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedTableIds, getTableAccess, groupPermissionResources, groupPermissionTables, setTableAccess, summarizeKeyPermissions, summarizeWorkspaceGrants, summarizePermissions } from '../src/components/settings/api-key-permissions.ts';

const tables = [
  { id: 'a', name: 'Contacts', workspaceId: 'workspace-a', workspaceName: 'Team' },
  { id: 'b', name: 'Contacts', workspaceId: 'workspace-b', workspaceName: 'Team' },
  { id: 'c', name: 'Tasks', workspaceId: 'workspace-a', workspaceName: 'Team' },
];
const grant = (tableId, enabled = true) => ({ tableId, canRead: enabled, canCreate: false, canUpdate: false, canDelete: false });

test('scope counts distinct authorized table/workspace identities, ignoring false grants and separating unavailable targets', () => {
  assert.deepEqual(summarizePermissions([grant('a'), grant('b'), grant('c'), grant('a'), grant('gone'), grant('off', false)], tables), { workspaceCount: 2, tableCount: 3, unavailableCount: 1 });
  assert.deepEqual(summarizePermissions([grant('a', false)], tables), { workspaceCount: 0, tableCount: 0, unavailableCount: 0 });
  assert.deepEqual(summarizePermissions([], tables), { workspaceCount: 0, tableCount: 0, unavailableCount: 0 });
  assert.deepEqual(summarizePermissions([grant('gone')], tables), { workspaceCount: 0, tableCount: 0, unavailableCount: 1 });
});

test('editor groups by workspace ID and disambiguates equal names without rewriting table names', () => {
  const groups = groupPermissionTables(tables);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.name), ['Team (workspace-a)', 'Team (workspace-b)']);
  assert.deepEqual(groups[0].tables.map(table => table.id), ['a', 'c']);
  assert.equal(groups[0].tables[0].name, 'Contacts');
  assert.equal(groupPermissionTables([tables[0]])[0].name, 'Team');
});

const empty = () => ({ name: 'Test', permissions: [], calendarPermissions: [], schedulePermissions: [] });
const access = (bits = {}) => ({ canRead: false, canCreate: false, canUpdate: false, canDelete: false, ...bits });
test('the table UI has exactly CRUD and saves only the original table grant', () => {
  const initial = empty();
  const granted = setTableAccess(initial, 'a', access({ canRead: true, canUpdate: true }));
  assert.deepEqual(granted.permissions, [{ tableId: 'a', ...access({ canRead: true, canUpdate: true }) }]);
  assert.deepEqual(getTableAccess(granted, 'a').access, access({ canRead: true, canUpdate: true }));
  assert.deepEqual(authorizedTableIds(granted), ['a']);
  assert(!('documentPermissions' in granted)); assert(!('blogPermissions' in granted));
  assert.deepEqual(setTableAccess(granted, 'a', access()), initial);
});
test('editing a table keeps calendar, schedule and other-table access intact', () => {
  const input = { ...empty(), permissions: [grant('a')], calendarPermissions: [{ calendarId: 'cal', canRead: true }], schedulePermissions: [{ automationId: 'plan', canUpdate: true }] };
  const edited = setTableAccess(input, 'b', access({ canCreate: true }));
  assert.deepEqual(setTableAccess(edited, 'b', access()), input);
});

test('workspace grouping includes calendars and plans in workspaces without tables', () => {
  const groups = groupPermissionResources([], [{ id: 'cal', name: 'Calendar', workspaceId: 'w', workspaceName: 'Team' }], [{ id: 'plan', name: 'Plan', workspaceId: 'w', workspaceName: 'Team' }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].tables.length, 0);
  assert.equal(groups[0].calendars[0].id, 'cal'); assert.equal(groups[0].schedules[0].id, 'plan');
});

test('four resource groups include empty workspaces and retain stable identities', () => {
  const groups = groupPermissionResources(tables, [], [], [{ id: 'rule', name: 'Rule', workspaceId: 'workspace-b', workspaceName: 'Team' }], [{ id: 'empty', name: 'Empty' }, { id: 'workspace-a', name: 'Team' }, { id: 'workspace-b', name: 'Team' }]);
  assert.equal(groups[0].workspaceId, 'empty'); assert.equal(groups[0].tables.length, 0); assert.equal(groups[0].automations.length, 0);
  assert.equal(groups[2].automations[0].id, 'rule'); assert.equal(groups[1].name, 'Team (workspace-a)');
});


test('scope summary includes every family, creation-only workspaces and unavailable resources', () => {
  const resource = (id, workspaceId) => ({ id, workspaceId, name: id, workspaceName: workspaceId });
  const input = { ...empty(), permissions: [grant('a'), grant('gone'), grant('off', false)],
    calendarPermissions: [{ calendarId: 'cal', canSubscribe: true }, { calendarId: 'off', canRead: false }],
    automationPermissions: [{ automationId: 'rule', canUpdate: true }], schedulePermissions: [{ automationId: 'plan', canDelete: true }],
    workspacePermissions: [{ workspaceId: 'empty', canCreateSchedules: true }, { workspaceId: 'off', canCreateSchedules: false }] };
  assert.deepEqual(summarizeKeyPermissions(input, tables, [resource('cal', 'workspace-b')], [resource('plan', 'workspace-b')], [resource('rule', 'workspace-a')]), { workspaceCount: 3, tableCount: 2, calendarCount: 1, automationCount: 1, scheduleCount: 1, creationCount: 1, unavailableCount: 1 });
});


test('workspace picker counts draft resources across categories, excluding false and other-workspace grants', () => {
  const resource = (id, workspaceId) => ({ id, workspaceId, name: id, workspaceName: workspaceId });
  const groups = groupPermissionResources(tables, [resource('cal', 'workspace-a')], [resource('plan', 'workspace-b')], [resource('rule', 'workspace-a')], [{ id: 'empty', name: '测试' }]);
  const input = { ...empty(), permissions: [grant('a'), grant('b'), grant('c', false), grant('gone')],
    calendarPermissions: [{ calendarId: 'cal', canSubscribe: true }], automationPermissions: [{ automationId: 'rule', canDelete: true }],
    schedulePermissions: [{ automationId: 'plan', canUpdate: true }], workspacePermissions: [{ workspaceId: 'empty', canCreateSchedules: true }] };
  assert.deepEqual(groups.map(group => [group.workspaceId, summarizeWorkspaceGrants(input, group)]), [
    ['empty', { resourceCount: 0, canCreate: true }], ['workspace-a', { resourceCount: 3, canCreate: false }], ['workspace-b', { resourceCount: 2, canCreate: false }],
  ]);
});

test('partial calendar grants count as authorized resources even without a full CRUD group', () => {
  const calendars = [{ id: 'cal', name: 'Calendar', workspaceId: 'workspace-a', workspaceName: 'Team' }];
  const input = { ...empty(), calendarPermissions: [{ calendarId: 'cal', ...access(), partialOperations: ['canRead'] }] };
  assert.equal(summarizeKeyPermissions(input, [], calendars, [], []).calendarCount, 1);
  assert.deepEqual(summarizeWorkspaceGrants(input, groupPermissionResources([], calendars, [], [])[0]), { resourceCount: 1, canCreate: false });
});
