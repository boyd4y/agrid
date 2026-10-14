import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@tabdo/platform/resources";
import { type Transaction } from "../db/context.js";
import { tables, columns, rows } from "../db/schema.js";

/** Tenant scope passed into commands from resolveActor (never trust client body alone). */
export type TenantScope = {
  organizationId: string;
};

export function requireOrgId(organizationId: string | undefined | null): string {
  const id = organizationId?.trim() ?? "";
  if (!id) throw new Error("缺少组织上下文");
  return id;
}

/** Load table; if organizationId set, hide cross-tenant as "not found". */
export async function requireTableInOrg(
  tableId: string,
  organizationId?: string | null,
  transaction?: Transaction
) {
  const [table] = await (transaction ?? getDatabase()).select().from(tables).where(eq(tables.id, tableId)).limit(1);
  if (!table) throw new Error(`表格不存在: ${tableId}`);
  if (organizationId && table.organizationId !== organizationId) {
    throw new Error(`表格不存在: ${tableId}`);
  }
  return table;
}

export async function requireRowInOrg(rowId: string, organizationId?: string | null, transaction?: Transaction) {
  const [hit] = await (transaction ?? getDatabase())
    .select({
      row: rows,
      organizationId: tables.organizationId,
      tableId: tables.id,
    })
    .from(rows)
    .innerJoin(tables, eq(rows.tableId, tables.id))
    .where(eq(rows.id, rowId))
    .limit(1);
  if (!hit) throw new Error(`行不存在: ${rowId}`);
  if (organizationId && hit.organizationId !== organizationId) {
    throw new Error(`行不存在: ${rowId}`);
  }
  return hit;
}

export async function requireColumnInOrg(
  columnId: string,
  organizationId?: string | null,
  transaction?: Transaction
) {
  const [hit] = await (transaction ?? getDatabase())
    .select({
      column: columns,
      organizationId: tables.organizationId,
      tableId: tables.id,
    })
    .from(columns)
    .innerJoin(tables, eq(columns.tableId, tables.id))
    .where(eq(columns.id, columnId))
    .limit(1);
  if (!hit) throw new Error(`列不存在: ${columnId}`);
  if (organizationId && hit.organizationId !== organizationId) {
    throw new Error(`列不存在: ${columnId}`);
  }
  return hit;
}

export async function listTablesForOrg(organizationId: string, transaction?: Transaction) {
  return (transaction ?? getDatabase())
    .select()
    .from(tables)
    .where(eq(tables.organizationId, organizationId))
    .orderBy(asc(tables.createdAt));
}

/** Ensure a table id is in org (boolean). */
export async function tableBelongsToOrg(tableId: string, organizationId: string) {
  const [t] = await getDatabase()
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.id, tableId), eq(tables.organizationId, organizationId)))
    .limit(1);
  return Boolean(t);
}
