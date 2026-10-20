import { readRowBody } from "./row-body.js";
import { requireWorkspace } from "../tenant/workspace.js";
import type { CommandDependencies } from "../dependencies.js";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { inTransaction, type Transaction } from "../db/context.js";
import {
  columns,
  rows,
  tables,
  tableRelations,
  rowRelations,
} from "../db/schema.js";
import {
  requireColumnInOrg,
  requireRowInOrg,
  requireOrgId,
} from "../tenant/scope.js";
import {
  changedColumns,
  clampLimit,
  decodeCursor,
  encodeCursor,
  type CellValue,
  type ColumnConfig,
  type ColumnDef,
  type RelationWriteInput,
  type RelationQueryInput,
} from "@tabdo/shared";
import { loadTableColumns } from "./formulas.js";
import { readRow, recordTitle } from "./relation-reads.js";
import { appendAutomationEvent } from "../automation/events.js";

type Scope = { organizationId?: string; actorId?: string };
const uuid = z.string().uuid();
export const relationConfigSchema = z.object({
  targetTableId: uuid,
  limit: z.enum(["one", "many"]).default("many"),
  inverseName: z.string().trim().min(1).max(100).optional(),
  inverseLimit: z.enum(["one", "many"]).default("many"),
});
export const rollupConfigSchema = z.object({
  relationColumnId: uuid,
  targetColumnId: uuid.optional(),
  operation: z.enum([
    "count",
    "sum",
    "average",
    "min",
    "max",
    "earliest",
    "latest",
  ]),
});

export async function affectedTables(
  deps: CommandDependencies,
  tableId: string,
  conn: Transaction | CommandDependencies["database"] = deps.database,
) {
  const defs = await conn
    .select()
    .from(tableRelations)
    .where(
      or(
        eq(tableRelations.sourceTableId, tableId),
        eq(tableRelations.targetTableId, tableId),
      ),
    );
  return [
    ...new Set([
      tableId,
      ...defs.flatMap((d) => [d.sourceTableId, d.targetTableId]),
    ]),
  ];
}
export async function createRelationColumn(
  deps: CommandDependencies,
  input: {
    tableId: string;
    name: string;
    config?: ColumnConfig;
    width?: number;
  } & Scope,
) {
  return inTransaction(deps, undefined, (tx) => createRelationColumnInTransaction(deps, tx, input));
}
export async function createRelationColumnInTransaction(
  deps: CommandDependencies,
  tx: Transaction,
  input: { tableId: string; name: string; config?: ColumnConfig; width?: number } & Scope,
) {
  const organizationId = requireOrgId(input.organizationId);
  const workspaceId = (await requireWorkspace(deps, organizationId, tx)).id;
  const config = relationConfigSchema.parse(input.config?.relation);
  const tableIds = [...new Set([input.tableId, config.targetTableId])].sort();
  const owned = await tx
    .select()
    .from(tables)
    .where(inArray(tables.id, tableIds))
    .orderBy(asc(tables.id))
    .for("update");
  if (
    owned.length !== tableIds.length ||
    owned.some((t) => t.organizationId !== organizationId || t.workspaceId !== workspaceId)
  )
    throw new Error("关联目标表不存在或不属于当前工作区");
  const insert = async (tableId: string, name: string) => {
    const [{ position }] = await tx
      .select({
        position: sql<number>`COALESCE(max(${columns.sortOrder}),-1)+1`,
      })
      .from(columns)
      .where(eq(columns.tableId, tableId));
    const [col] = await tx
      .insert(columns)
      .values({
        tableId,
        name,
        type: "relation",
        config: {},
        width: input.width ?? 220,
        sortOrder: position,
      })
      .returning();
    return col;
  };
  const source = await insert(input.tableId, input.name);
  const inverse = config.inverseName
    ? await insert(config.targetTableId, config.inverseName)
    : null;
  const [def] = await tx
    .insert(tableRelations)
    .values({
      organizationId,
      sourceTableId: input.tableId,
      targetTableId: config.targetTableId,
      sourceColumnId: source.id,
      inverseColumnId: inverse?.id,
      sourceSingle: config.limit === "one",
      targetSingle: config.inverseLimit === "one",
    })
    .returning();
  const [updated] = await tx
    .update(columns)
    .set({
      config: {
        ...input.config,
        relation: {
          relationId: def.id,
          direction: "source",
          targetTableId: config.targetTableId,
          limit: config.limit,
        },
      },
    })
    .where(eq(columns.id, source.id))
    .returning();
  if (inverse)
    await tx
      .update(columns)
      .set({
        config: {
          relation: {
            relationId: def.id,
            direction: "target",
            targetTableId: input.tableId,
            limit: config.inverseLimit,
          },
        },
      })
      .where(eq(columns.id, inverse.id));
  return { ...updated, affectedTableIds: tableIds };
}
export async function validateRollup(
  deps: CommandDependencies,
  tx: Transaction | CommandDependencies["database"],
  tableId: string,
  raw: unknown,
) {
  const config = rollupConfigSchema.parse(raw);
  const [rel] = await tx
    .select()
    .from(columns)
    .where(
      and(
        eq(columns.id, config.relationColumnId),
        eq(columns.tableId, tableId),
      ),
    )
    .for("share");
  if (rel?.type !== "relation" || !rel.config.relation)
    throw new Error("汇总需要选择本表的关联字段");
  if (config.operation !== "count") {
    if (!config.targetColumnId) throw new Error("请选择需要汇总的目标字段");
    const [target] = await tx
      .select()
      .from(columns)
      .where(
        and(
          eq(columns.id, config.targetColumnId),
          eq(columns.tableId, rel.config.relation.targetTableId),
        ),
      )
      .for("share");
    const type = ["earliest", "latest"].includes(config.operation)
      ? "date"
      : "number";
    if (target?.type !== type)
      throw new Error(
        `此汇总只能选择${type === "date" ? "日期" : "数字"}字段，不支持嵌套汇总`,
      );
  }
  return config;
}
export async function assertNoRollupDependency(
  deps: CommandDependencies,
  ids: string[],
  conn: Transaction | CommandDependencies["database"] = deps.database,
) {
  const dependent = await conn
    .select()
    .from(columns)
    .where(eq(columns.type, "rollup"));
  const found = dependent.find(
    (c) =>
      ids.includes(c.config.rollup?.relationColumnId ?? "") ||
      ids.includes(c.config.rollup?.targetColumnId ?? ""),
  );
  if (found)
    throw new Error(`字段被汇总「${found.name}」引用，请先删除该汇总字段`);
}

type Plan = {
  col: ColumnDef;
  def: typeof tableRelations.$inferSelect;
  before: string[];
  after: string[];
};
/** Lock definitions first, then every affected row in a stable order. */
export async function prepareRelationWrites(
  deps: CommandDependencies,
  tx: Transaction,
  rowId: string,
  cols: ColumnDef[],
  values: Record<string, CellValue>,
  mode: "set" | "add" | "remove" = "set",
) {
  const relCols = cols.filter(
    (c) => c.type === "relation" && Object.hasOwn(values, c.id),
  );
  const ids = relCols
    .map((c) => c.config.relation?.relationId)
    .filter((id): id is string => Boolean(id));
  const defs = ids.length
    ? await tx
        .select()
        .from(tableRelations)
        .where(inArray(tableRelations.id, ids))
        .orderBy(asc(tableRelations.id))
        .for("update")
    : [];
  const plans: Plan[] = [];
  // Schema edits/deletions lock definitions before columns, matching this order.
  // Synthetic incoming columns used during deletion are deliberately not persisted.
  const currentColumns = await tx
    .select()
    .from(columns)
    .where(
      inArray(
        columns.id,
        cols.map((c) => c.id),
      ),
    )
    .orderBy(asc(columns.id))
    .for("share");
  for (const col of cols) {
    if (!currentColumns.some((c) => c.id === col.id)) {
      if (defs.some((d) => d.id === col.id && !d.inverseColumnId)) continue;
      throw new Error("字段已删除，请刷新后重试");
    }
    const current = currentColumns.find((c) => c.id === col.id)!;
    if (
      current.type !== col.type ||
      JSON.stringify(current.config) !== JSON.stringify(col.config)
    )
      throw new Error("字段配置已变化，请刷新后重试");
  }
  for (const col of relCols) {
    const def = defs.find((d) => d.id === col.config.relation?.relationId);
    if (!def) throw new Error("关联字段配置已失效");
    const input = z
      .array(uuid)
      .max(1000)
      .parse(values[col.id] ?? []);
    const inverse = col.config.relation?.direction === "target";
    const edges = await tx
      .select()
      .from(rowRelations)
      .where(
        and(
          eq(rowRelations.relationId, def.id),
          eq(
            inverse ? rowRelations.targetRowId : rowRelations.sourceRowId,
            rowId,
          ),
        ),
      );
    const before = edges
      .map((e) => (inverse ? e.sourceRowId : e.targetRowId))
      .sort();
    const after = [
      ...new Set(
        mode === "set"
          ? input
          : mode === "add"
            ? [...before, ...input]
            : before.filter((id) => !input.includes(id)),
      ),
    ].sort();
    if ((inverse ? def.targetSingle : def.sourceSingle) && after.length > 1)
      throw new Error(`「${col.name}」最多关联一条记录`);
    plans.push({ col, def, before, after });
  }
  const rowIds = [
    ...new Set([rowId, ...plans.flatMap((p) => [...p.before, ...p.after])]),
  ].sort();
  const locked = await tx
    .select()
    .from(rows)
    .where(inArray(rows.id, rowIds))
    .orderBy(asc(rows.id))
    .for("update");
  for (const p of plans) {
    const target = p.col.config.relation!.targetTableId;
    if (
      p.after.some(
        (id) => !locked.some((r) => r.id === id && r.tableId === target),
      )
    )
      throw new Error("关联记录不存在或不属于目标表格");
  }
  return { plans, locked };
}
export async function applyRelationWrites(
  deps: CommandDependencies,
  tx: Transaction,
  plans: Plan[],
  rowId: string,
  scope: Scope & { skipAutomation?: boolean },
) {
  const peers = new Map<
    string,
    {
      before: Record<string, CellValue>;
      cols: ColumnDef[];
      tableId: string;
      changed: Set<string>;
    }
  >();
  for (const p of plans) {
    if (JSON.stringify(p.before) === JSON.stringify(p.after)) continue;
    const inverse = p.col.config.relation?.direction === "target";
    const inverseId = inverse ? p.def.sourceColumnId : p.def.inverseColumnId;
    const changedIds = [
      ...new Set([
        ...p.before.filter((id) => !p.after.includes(id)),
        ...p.after.filter((id) => !p.before.includes(id)),
      ]),
    ];
    if (inverseId)
      for (const id of changedIds) {
        if (id === rowId) continue;
        if (peers.has(id)) {
          peers.get(id)!.changed.add(inverseId);
          continue;
        }
        const tableId = p.col.config.relation!.targetTableId,
          cols = await loadTableColumns(deps, tableId, tx);
        const before = await readRow(deps, id, cols, tx, true);
        peers.set(id, {
          before: before.cells,
          cols,
          tableId,
          changed: new Set([inverseId]),
        });
      }
    const edgeWhere = and(
      eq(rowRelations.relationId, p.def.id),
      eq(inverse ? rowRelations.targetRowId : rowRelations.sourceRowId, rowId),
    );
    const removed = p.before.filter((id) => !p.after.includes(id));
    if (removed.length)
      await tx
        .delete(rowRelations)
        .where(
          and(
            edgeWhere,
            inArray(
              inverse ? rowRelations.sourceRowId : rowRelations.targetRowId,
              removed,
            ),
          ),
        );
    const added = p.after.filter((id) => !p.before.includes(id));
    if (added.length)
      await tx
        .insert(rowRelations)
        .values(
          added.map((id) => ({
            relationId: p.def.id,
            sourceRowId: inverse ? id : rowId,
            targetRowId: inverse ? rowId : id,
            sourceSingle: p.def.sourceSingle,
            targetSingle: p.def.targetSingle,
          })),
        )
        .onConflictDoNothing({
          target: [
            rowRelations.relationId,
            rowRelations.sourceRowId,
            rowRelations.targetRowId,
          ],
        });
  }
  for (const [id, peer] of peers) {
    await tx
      .update(rows)
      .set({ version: sql`${rows.version}+1`, updatedAt: deps.now() })
      .where(eq(rows.id, id));
    const after = await readRow(deps, id, peer.cols, tx, true);
    if (!scope.skipAutomation) {
      const changed = [
        ...new Set([
          ...changedColumns(peer.before, after.cells),
          ...peer.changed,
        ]),
      ];
      if (changed.length)
        await appendAutomationEvent(
          deps, tx,
          requireOrgId(scope.organizationId),
          {
            type: "cells_changed",
            tableId: peer.tableId,
            rowId: id,
            before: peer.before,
            after: after.cells,
            changedColumnIds: changed,
          },
          after,
          peer.cols,
          scope.actorId,
        );
    }
  }
}
export async function queryRelationRecords(deps: CommandDependencies, raw: RelationQueryInput & Scope, transaction?: Transaction) {
  const input = z
    .object({
      columnId: uuid,
      rowId: uuid.optional(),
      mode: z.enum(["candidates", "related"]).default("candidates"),
      recordIds: z.array(uuid).max(100).optional(),
      search: z.string().max(200).default(""),
      cursor: z.string().nullable().optional(),
      limit: z.number().int().positive().optional(),
    })
    .parse(raw);
  const { column } = await requireColumnInOrg(
    deps, input.columnId,
    raw.organizationId,
    transaction,
  );
  const config = column.config.relation;
  if (column.type !== "relation" || !config?.relationId)
    throw new Error("字段不是关联类型");
  if (input.rowId) {
    const hit = await requireRowInOrg(deps, input.rowId, raw.organizationId, transaction);
    if (hit.row.tableId !== column.tableId)
      throw new Error("记录不属于关联字段所在表格");
  }
  if (input.mode === "related" && !input.rowId)
    throw new Error("读取关联记录需要 rowId");
  const inverse = config.direction === "target";
  const selected = input.rowId
    ? sql<boolean>`EXISTS(SELECT 1 FROM row_relations rr WHERE rr.relation_id=${config.relationId}::uuid AND ${inverse ? sql`rr.target_row_id` : sql`rr.source_row_id`}=${input.rowId}::uuid AND ${inverse ? sql`rr.source_row_id` : sql`rr.target_row_id`}=${rows.id})`
    : sql<boolean>`false`;
  const cursor = decodeCursor(input.cursor);
  if (input.cursor && !cursor) throw new Error("分页游标无效");
  const conditions = [
    eq(rows.tableId, config.targetTableId),
    sql`${recordTitle("rows")} ILIKE ${"%" + input.search + "%"}`,
  ];
  if (input.recordIds)
    conditions.push(
      input.recordIds.length ? inArray(rows.id, input.recordIds) : sql`false`,
    );
  if (input.mode === "related") conditions.push(selected);
  if (cursor)
    conditions.push(
      sql`(${rows.sortOrder},${rows.id}) > (${cursor.sortOrder},${cursor.id}::uuid)`,
    );
  const limit = clampLimit(input.limit, 30, 100);
  const list = await (transaction ?? deps.database)
    .select({
      id: rows.id,
      tableId: rows.tableId,
      title: sql<string>`${recordTitle("rows")}`,
      selected,
      sortOrder: rows.sortOrder,
    })
    .from(rows)
    .where(and(...conditions))
    .orderBy(asc(rows.sortOrder), asc(rows.id))
    .limit(limit + 1);
  const hasMore = list.length > limit,
    records = list.slice(0, limit),
    last = records.at(-1);
  return {
    records: records.map(({ sortOrder, ...record }) => record),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ id: last.id, sortOrder: last.sortOrder })
        : null,
  };
}
export async function getRow(deps: CommandDependencies, input: import("@tabdo/shared").GetRowInput & Scope, transaction?: Transaction) {
  const { row } = await requireRowInOrg(
    deps, uuid.parse(input.rowId),
    input.organizationId,
    transaction,
  );
  const cols = await loadTableColumns(deps, row.tableId, transaction);
  return { ...(await readRow(deps, row.id, cols, transaction)), columns: cols, ...(input.includeBody ? { body: await readRowBody(transaction ?? deps.database, row.tableId, row.id, input.bodyFormat) } : {}) };
}
