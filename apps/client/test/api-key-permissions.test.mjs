import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedTableIds, getTableAccess, groupPermissionResources, groupPermissionTables, setTableAccess, summarizePermissions } from '../src/components/settings/api-key-permissions.ts';

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
