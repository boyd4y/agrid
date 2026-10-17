import assert from 'node:assert/strict';
import test from 'node:test';
import { groupPermissionTables, summarizePermissions } from '../src/components/settings/api-key-permissions.ts';

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
