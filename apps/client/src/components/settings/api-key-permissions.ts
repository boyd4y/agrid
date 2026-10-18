import type { ApiKeyInput, BlogPermission, DocumentPermission, TableMeta, TablePermission } from "@tabdo/shared";

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

export type TableAccess = Record<typeof operations[number], boolean> & { canPublish: boolean };
export const tableOperations = [...operations, "canPublish"] as const;

// Build also permits link-based public previews in the existing API. Keep both
// capabilities behind the explicit publication choice, without changing old keys.
export function tableAccessGrants(tableId: string, access: TableAccess) {
  const { canRead, canCreate, canUpdate, canDelete, canPublish } = access;
  const table: TablePermission = { tableId, canRead, canCreate, canUpdate, canDelete };
  // Create uses createDocument. Only Update needs both bits for lazy body
  // creation via replaceDocument(0), plus upload and existing blog configuration.
  const document: DocumentPermission = { tableId, canRead, canCreate: canCreate || canUpdate, canUpdate,
    canUpload: canUpdate, canReadHistory: false, canRestore: false };
  const blog: BlogPermission = { tableId, canRead, canConfigure: canUpdate, canBuild: canPublish, canPublish, canRestore: false };
  return { table, document, blog };
}

export function getTableAccess(input: ApiKeyInput, tableId: string) {
  const table = input.permissions.find(p => p.tableId === tableId);
  const document = input.documentPermissions?.find(p => p.tableId === tableId);
  const blog = input.blogPermissions?.find(p => p.tableId === tableId);
  const access: TableAccess = { canRead: table?.canRead ?? false, canCreate: table?.canCreate ?? false,
    canUpdate: table?.canUpdate ?? false, canDelete: table?.canDelete ?? false, canPublish: blog?.canPublish ?? false };
  const expected = tableAccessGrants(tableId, access);
  const matches = (actual: object | undefined, target: object) => Object.entries(target).every(([key, value]) => key === "tableId" || Boolean((actual as Record<string, unknown> | undefined)?.[key]) === value);
  return { access, legacy: !matches(table, expected.table) || !matches(document, expected.document) || !matches(blog, expected.blog) };
}

export function setTableAccess(input: ApiKeyInput, tableId: string, access: TableAccess): ApiKeyInput {
  const grants = tableAccessGrants(tableId, access);
  const replace = <T extends { tableId: string }>(all: T[] = [], grant: T) => [
    ...all.filter(p => p.tableId !== tableId),
    ...(Object.entries(grant as Record<string, unknown>).some(([key, value]) => key !== "tableId" && value === true) ? [grant] : []),
  ];
  return { ...input, permissions: replace(input.permissions, grants.table),
    documentPermissions: replace(input.documentPermissions, grants.document), blogPermissions: replace(input.blogPermissions, grants.blog) };
}

export function authorizedTableIds(input: ApiKeyInput) {
  return [...new Set([...input.permissions, ...(input.documentPermissions ?? []), ...(input.blogPermissions ?? [])]
    .filter(grant => Object.entries(grant).some(([key, value]) => key !== "tableId" && value === true)).map(grant => grant.tableId))];
}

export type PermissionResource = { id: string; name: string; workspaceId: string; workspaceName: string };
export function groupPermissionResources(tables: readonly ApiKeyTable[], calendars: readonly PermissionResource[], schedules: readonly PermissionResource[]) {
  const groups = new Map(groupPermissionTables(tables).map(group => [group.workspaceId, { ...group, calendars: [] as PermissionResource[], schedules: [] as PermissionResource[] }]));
  for (const [kind, resources] of [["calendars", calendars], ["schedules", schedules]] as const) {
    for (const resource of resources) {
      const group = groups.get(resource.workspaceId) ?? { workspaceId: resource.workspaceId, name: resource.workspaceName, tables: [], calendars: [], schedules: [] };
      group[kind].push(resource); groups.set(resource.workspaceId, group);
    }
  }
  const originalNames = new Map([...tables, ...calendars, ...schedules].map(resource => [resource.workspaceId, resource.workspaceName]));
  const counts = new Map<string, number>();
  for (const name of originalNames.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...groups.values()].map(group => ({ ...group, name: counts.get(originalNames.get(group.workspaceId)!)! > 1
    ? `${originalNames.get(group.workspaceId)} (${group.workspaceId})` : originalNames.get(group.workspaceId)! }));
}
