import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedTableIds, getTableAccess, groupPermissionResources, groupPermissionTables, setTableAccess, summarizePermissions, tableAccessGrants } from '../src/components/settings/api-key-permissions.ts';

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

const empty = () => ({ name: 'Test', permissions: [], documentPermissions: [], blogPermissions: [], calendarPermissions: [], schedulePermissions: [] });
const access = (overrides = {}) => ({ canRead: false, canCreate: false, canUpdate: false, canDelete: false, canPublish: false, ...overrides });

test('unified read includes private bodies/images and internal blog reads, never writes or public previews', () => {
  const result = setTableAccess(empty(), 'a', access({ canRead: true }));
  assert.deepEqual(result.permissions, [grant('a')]);
  assert.deepEqual(result.documentPermissions, [{ tableId: 'a', canRead: true, canCreate: false, canUpdate: false, canUpload: false, canReadHistory: false, canRestore: false }]);
  assert.deepEqual(result.blogPermissions, [{ tableId: 'a', canRead: true, canConfigure: false, canBuild: false, canPublish: false, canRestore: false }]);
  assert.equal(getTableAccess(result, 'a').legacy, false);
});

test('create/update cover body upsert and upload plus draft configuration; only explicit publish enables build and shared preview', () => {
  for (const op of ['canCreate', 'canUpdate']) {
    const { table, document, blog } = tableAccessGrants('a', access({ [op]: true }));
    assert.equal(table[op], true);
    assert.equal(document.canCreate, true); assert.equal(document.canUpdate, true); assert.equal(document.canUpload, true);
    assert.equal(document.canRead, false); assert.equal(document.canRestore, false);
    assert.equal(blog.canConfigure, true); assert.equal(blog.canBuild, false); assert.equal(blog.canPublish, false); assert.equal(blog.canRestore, false);
  }
  const result = setTableAccess(empty(), 'a', access({ canPublish: true }));
  assert.deepEqual(result.permissions, []); assert.deepEqual(result.documentPermissions, []);
  assert.equal(result.blogPermissions[0].canBuild, true); assert.equal(result.blogPermissions[0].canPublish, true);
  assert.deepEqual(authorizedTableIds(result), ['a']);
  assert.equal(getTableAccess(result, 'a').legacy, false);
});

test('legacy read without body, write-only, preview-only, history/restore and independent document grants require explicit conversion', () => {
  const legacyInputs = [
    { ...empty(), permissions: [grant('a')] },
    { ...empty(), documentPermissions: [{ tableId: 'a', canRead: true }] },
    { ...empty(), blogPermissions: [{ tableId: 'a', canBuild: true }] },
    { ...empty(), documentPermissions: [{ tableId: 'a', canReadHistory: true, canRestore: true }] },
    { ...empty(), blogPermissions: [{ tableId: 'a', canRestore: true }] },
    { ...empty(), permissions: [{ ...grant('a'), canCreate: true }] },
  ];
  for (const input of legacyInputs) {
    const snapshot = structuredClone(input);
    assert.equal(getTableAccess(input, 'a').legacy, true);
    getTableAccess(input, 'b');
    assert.deepEqual(input, snapshot, 'opening or viewing never normalizes');
    const other = setTableAccess(input, 'b', access({ canRead: true }));
    for (const family of ['permissions', 'documentPermissions', 'blogPermissions']) assert.deepEqual(other[family].filter(p => p.tableId === 'a'), input[family]);
    const converted = setTableAccess(input, 'a', getTableAccess(input, 'a').access);
    assert.equal(getTableAccess(converted, 'a').legacy, false);
  }
});

test('editing one table preserves every untouched resource and removal clears only that table bundle', () => {
  const input = { ...setTableAccess(empty(), 'a', access({ canRead: true })),
    documentPermissions: [{ tableId: 'a', canRead: true, canReadHistory: true }],
    calendarPermissions: [{ calendarId: 'cal', canTriggerAgent: true }], schedulePermissions: [{ automationId: 'plan', canUpdate: true }] };
  const added = setTableAccess(input, 'b', access({ canUpdate: true }));
  const removed = setTableAccess(added, 'b', access());
  assert.deepEqual(removed, input);
});

test('workspace grouping includes calendars and plans in workspaces without tables', () => {
  const groups = groupPermissionResources([], [{ id: 'cal', name: 'Calendar', workspaceId: 'w', workspaceName: 'Team' }], [{ id: 'plan', name: 'Plan', workspaceId: 'w', workspaceName: 'Team' }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].tables.length, 0);
  assert.equal(groups[0].calendars[0].id, 'cal'); assert.equal(groups[0].schedules[0].id, 'plan');
});
