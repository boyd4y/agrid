import type { ApiKeyInput, TableMeta, TablePermission } from "@tabdo/shared";

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

export type TableAccess = Record<typeof operations[number], boolean>;
export const tableOperations = operations;
export function getTableAccess(input: ApiKeyInput, tableId: string) {
  const table = input.permissions.find(p => p.tableId === tableId);
  return { access: { canRead: table?.canRead ?? false, canCreate: table?.canCreate ?? false, canUpdate: table?.canUpdate ?? false, canDelete: table?.canDelete ?? false } };
}
export function setTableAccess(input: ApiKeyInput, tableId: string, access: TableAccess): ApiKeyInput {
  return { ...input, permissions: [...input.permissions.filter(p => p.tableId !== tableId), ...(operations.some(op => access[op]) ? [{ tableId, ...access }] : [])] };
}
export function authorizedTableIds(input: ApiKeyInput) { return input.permissions.filter(grant => operations.some(op => grant[op])).map(grant => grant.tableId); }

export type PermissionResource = { id: string; name: string; workspaceId: string; workspaceName: string };

/** Count all granted families and their workspaces, including workspace creation grants. */
export function summarizeKeyPermissions(key: ApiKeyInput, tables: readonly ApiKeyTable[], calendars: readonly PermissionResource[], schedules: readonly PermissionResource[], automations: readonly PermissionResource[]) {
  const workspaceIds = new Set<string>();
  let unavailableCount = 0;
  function count(ids: readonly string[], resources: readonly PermissionResource[]) {
    const byId = new Map(resources.map(resource => [resource.id, resource]));
    for (const id of new Set(ids)) {
      const resource = byId.get(id);
      if (resource) workspaceIds.add(resource.workspaceId);
      else unavailableCount++;
    }
    return new Set(ids).size;
  }
  const tableCount = count(authorizedTableIds(key), tables);
  const calendarCount = count((key.calendarPermissions ?? []).filter(p => Object.entries(p).some(([name, value]) => name.startsWith("can") && value === true)).map(p => p.calendarId), calendars);
  const automationCount = count((key.automationPermissions ?? []).filter(p => p.canRead || p.canUpdate || p.canDelete).map(p => p.automationId), automations);
  const scheduleCount = count((key.schedulePermissions ?? []).filter(p => p.canRead || p.canUpdate || p.canDelete).map(p => p.automationId), schedules);
  const creationWorkspaces = new Set((key.workspacePermissions ?? []).filter(p => p.canCreateAutomations || p.canCreateSchedules).map(p => p.workspaceId));
  for (const id of creationWorkspaces) workspaceIds.add(id);
  return { workspaceCount: workspaceIds.size, tableCount, calendarCount, automationCount, scheduleCount, creationCount: creationWorkspaces.size, unavailableCount };
}

export function groupPermissionResources(tables: readonly ApiKeyTable[], calendars: readonly PermissionResource[], schedules: readonly PermissionResource[], automations: readonly PermissionResource[] = [], workspaces: readonly { id: string; name: string }[] = []) {
  const groups = new Map(workspaces.map(workspace => [workspace.id, { workspaceId: workspace.id, name: workspace.name, tables: [] as ApiKeyTable[], calendars: [] as PermissionResource[], schedules: [] as PermissionResource[], automations: [] as PermissionResource[] }]));
  for (const [kind, resources] of [["tables", tables], ["calendars", calendars], ["schedules", schedules], ["automations", automations]] as const) {
    for (const resource of resources) {
      const group = groups.get(resource.workspaceId) ?? { workspaceId: resource.workspaceId, name: resource.workspaceName, tables: [], calendars: [], schedules: [], automations: [] };
      (group[kind] as PermissionResource[]).push(resource); groups.set(resource.workspaceId, group);
    }
  }
  const counts = new Map<string, number>();
  for (const group of groups.values()) counts.set(group.name, (counts.get(group.name) ?? 0) + 1);
  return [...groups.values()].map(group => ({ ...group, name: counts.get(group.name)! > 1 ? `${group.name} (${group.workspaceId})` : group.name }));
}

/** Summarize the whole workspace draft, independently of the visible category. */
export function summarizeWorkspaceGrants(input: ApiKeyInput, group: ReturnType<typeof groupPermissionResources>[number]) {
  const summary = summarizeKeyPermissions(input, group.tables, group.calendars, group.schedules, group.automations);
  // Exclude targets outside this workspace, including unavailable resources.
  const resourceCount = summary.tableCount + summary.calendarCount + summary.automationCount + summary.scheduleCount - summary.unavailableCount;
  const canCreate = input.workspacePermissions?.some(grant => grant.workspaceId === group.workspaceId && (grant.canCreateAutomations || grant.canCreateSchedules)) ?? false;
  return { resourceCount, canCreate };
}
