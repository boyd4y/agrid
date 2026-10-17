import type { TableMeta, TablePermission } from "@tabdo/shared";

export type ApiKeyTable = TableMeta & { workspaceName: string };
export const operations = ["canRead", "canCreate", "canUpdate", "canDelete"] as const;

export function summarizePermissions(permissions: readonly TablePermission[], tables: readonly ApiKeyTable[]) {
  const byId = new Map(tables.map(table => [table.id, table]));
  const tableIds = new Set(permissions.filter(grant => operations.some(op => grant[op])).map(grant => grant.tableId));
  const workspaceIds = new Set<string>();
  let tableCount = 0;
  for (const tableId of tableIds) {
    const table = byId.get(tableId);
    if (table) { tableCount++; workspaceIds.add(table.workspaceId); }
  }
  return { workspaceCount: workspaceIds.size, tableCount, unavailableCount: tableIds.size - tableCount };
}

export function groupPermissionTables(tables: readonly ApiKeyTable[]) {
  const groups = new Map<string, { workspaceId: string; name: string; tables: ApiKeyTable[] }>();
  for (const table of tables) {
    const group = groups.get(table.workspaceId) ?? { workspaceId: table.workspaceId, name: table.workspaceName, tables: [] };
    group.tables.push(table);
    groups.set(table.workspaceId, group);
  }
  const names = new Map<string, number>();
  for (const group of groups.values()) names.set(group.name, (names.get(group.name) ?? 0) + 1);
  return [...groups.values()].map(group => ({ ...group,
    name: names.get(group.name)! > 1 ? `${group.name} (${group.workspaceId})` : group.name,
  }));
}
