import { workspaceScope, workspaceMatches } from "./workspace.js";
import type { DatabaseDependencies } from "../dependencies.js";
import { and, asc, eq } from "drizzle-orm";

import { type Transaction } from "../db/context.js";
import { tables, columns, rows } from "../db/schema.js";

/** Tenant scope passed into commands from resolveActor (never trust client body alone). */
export type TenantScope = {
  organizationId: string;
  workspaceId: string;
};

export function requireOrgId(organizationId: string | undefined | null): string {
  const id = organizationId?.trim() ?? "";
  if (!id) throw new Error("缺少组织上下文");
  return id;
}

/** Load in the caller enterprise and explicit/default workspace; hide cross-scope IDs. */
export async function requireTableInOrg(
  deps: DatabaseDependencies,
  tableId: string,
  organizationId?: string | null,
  transaction?: Transaction
) {
  const orgId = requireOrgId(organizationId);
  const [table] = await (transaction ?? deps.database).select().from(tables).where(eq(tables.id, tableId)).limit(1);
  if (!table) throw new Error(`表格不存在: ${tableId}`);
  if (table.organizationId !== orgId || !(await workspaceMatches(deps, table, transaction))) {
    throw new Error(`表格不存在: ${tableId}`);
  }
  return table;
}

export async function requireRowInOrg(deps: DatabaseDependencies, rowId: string, organizationId?: string | null, transaction?: Transaction) {
  const orgId = requireOrgId(organizationId);
  const [hit] = await (transaction ?? deps.database)
    .select({
      row: rows,
      organizationId: tables.organizationId,
      workspaceId: tables.workspaceId,
      tableId: tables.id,
    })
    .from(rows)
    .innerJoin(tables, eq(rows.tableId, tables.id))
    .where(eq(rows.id, rowId))
    .limit(1);
  if (!hit) throw new Error(`行不存在: ${rowId}`);
  if (hit.organizationId !== orgId || !(await workspaceMatches(deps, hit, transaction))) {
    throw new Error(`行不存在: ${rowId}`);
  }
  return hit;
}

export async function requireColumnInOrg(
  deps: DatabaseDependencies,
  columnId: string,
  organizationId?: string | null,
  transaction?: Transaction
) {
  const orgId = requireOrgId(organizationId);
  const [hit] = await (transaction ?? deps.database)
    .select({
      column: columns,
      organizationId: tables.organizationId,
      workspaceId: tables.workspaceId,
      tableId: tables.id,
    })
    .from(columns)
    .innerJoin(tables, eq(columns.tableId, tables.id))
    .where(eq(columns.id, columnId))
    .limit(1);
  if (!hit) throw new Error(`列不存在: ${columnId}`);
  if (hit.organizationId !== orgId || !(await workspaceMatches(deps, hit, transaction))) {
    throw new Error(`列不存在: ${columnId}`);
  }
  return hit;
}

export async function listTablesForOrg(deps: DatabaseDependencies, organizationId: string, transaction?: Transaction) {
  return (transaction ?? deps.database)
    .select()
    .from(tables)
    .where(and(eq(tables.organizationId, organizationId), workspaceScope(deps, organizationId, tables.workspaceId)))
    .orderBy(asc(tables.createdAt));
}

/** Ensure a table id is in org (boolean). */
export async function tableBelongsToOrg(deps: DatabaseDependencies, tableId: string, organizationId: string) {
  const [t] = await deps.database
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.id, tableId), eq(tables.organizationId, organizationId), workspaceScope(deps, organizationId, tables.workspaceId)))
    .limit(1);
  return Boolean(t);
}
