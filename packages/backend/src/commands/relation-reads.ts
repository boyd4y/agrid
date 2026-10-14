import type { CommandDependencies } from "../dependencies.js";
import { sql, eq, type SQL, getTableColumns } from "drizzle-orm";
import { rows } from "../db/schema.js";

import { type Transaction } from "../db/context.js";
import type { ColumnDef, RowData } from "@tabdo/shared";

export function relationPredicate(col: ColumnDef): SQL {
  const config = col.config.relation;
  if (!config?.relationId) return sql`false`;
  return config.direction === "target"
    ? sql`rr.relation_id = ${config.relationId}::uuid AND rr.target_row_id = ${rows.id}`
    : sql`rr.relation_id = ${config.relationId}::uuid AND rr.source_row_id = ${rows.id}`;
}
export function relatedId(col: ColumnDef): SQL {
  return col.config.relation?.direction === "target"
    ? sql`rr.source_row_id`
    : sql`rr.target_row_id`;
}
export function recordTitle(alias: string): SQL {
  // alias is an internal constant, never user-provided.
  const ref = sql.raw(alias);
  return sql`COALESCE(NULLIF(${ref}.cells ->> (SELECT c.id::text FROM columns c WHERE c.table_id=${ref}.table_id AND c.type='text' ORDER BY c.sort_order,c.id LIMIT 1), ''), '无标题')`;
}
export function rollupExpression(col: ColumnDef, cols: ColumnDef[]): SQL {
  const config = col.config.rollup;
  const relation = cols.find(
    (c) => c.id === config?.relationColumnId && c.type === "relation",
  );
  if (!config || !relation?.config.relation?.relationId) return sql`NULL`;
  const predicate = relationPredicate(relation);
  if (config.operation === "count")
    return sql`(SELECT count(*)::int FROM row_relations rr WHERE ${predicate})`;
  const value = sql`NULLIF(target.cells ->> ${config.targetColumnId ?? ""}, '')`;
  let aggregate: SQL;
  switch (config.operation) {
    case "sum":
      aggregate = sql`COALESCE(sum((${value})::numeric),0)`;
      break;
    case "average":
      aggregate = sql`avg((${value})::numeric)`;
      break;
    case "min":
      aggregate = sql`min((${value})::numeric)`;
      break;
    case "max":
      aggregate = sql`max((${value})::numeric)`;
      break;
    case "earliest":
      aggregate = sql`min(${value})`;
      break;
    case "latest":
      aggregate = sql`max(${value})`;
      break;
  }
  return sql`(SELECT ${aggregate} FROM row_relations rr JOIN rows target ON target.id=${relatedId(relation)} WHERE ${predicate})`;
}
export function cellExpression(
  columnId: string,
  cols: ColumnDef[],
  json = false,
  fullRelations = false,
): SQL {
  const col = cols.find((c) => c.id === columnId);
  if (col?.type === "rollup") {
    const expr = rollupExpression(col, cols);
    return json ? sql`to_jsonb(${expr})` : sql`(${expr})::text`;
  }
  if (col?.type === "relation") {
    // Preview only. Membership/empty filters query edges, never this truncated array.
    const expr = sql`COALESCE((SELECT jsonb_agg(link.id) FROM (SELECT ${relatedId(col)} AS id FROM row_relations rr WHERE ${relationPredicate(col)} ORDER BY ${relatedId(col)} ${fullRelations ? sql`` : sql`LIMIT 20`}) link),'[]'::jsonb)`;
    return json ? expr : sql`(${expr})::text`;
  }
  return json
    ? sql`${rows.cells} -> ${columnId}`
    : sql`${rows.cells} ->> ${columnId}`;
}
export function rowProjection(cols: ColumnDef[], fullRelations = false) {
  const virtual = cols.filter(
    (c) => c.type === "relation" || c.type === "rollup",
  );
  const pairs = virtual.flatMap((c) => [
    sql`${c.id}::text`,
    cellExpression(c.id, cols, true, fullRelations),
  ]);
  const relations = cols
    .filter((c) => c.type === "relation")
    .flatMap((col) => [
      sql`${col.id}::text`,
      sql`jsonb_build_object(
    'total',(SELECT count(*)::int FROM row_relations rr WHERE ${relationPredicate(col)}),
    'records',COALESCE((SELECT jsonb_agg(record) FROM (SELECT jsonb_build_object('id',target.id,'tableId',target.table_id,'title',${recordTitle("target")}) AS record
       FROM row_relations rr JOIN rows target ON target.id=${relatedId(col)} WHERE ${relationPredicate(col)} ORDER BY target.id LIMIT 20) preview),'[]'::jsonb))`,
    ]);
  return {
    ...getTableColumns(rows),
    cells: sql<
      RowData["cells"]
    >`${rows.cells} || ${pairs.length ? sql`jsonb_build_object(${sql.join(pairs, sql`,`)})` : sql`'{}'::jsonb`}`,
    relations: sql<
      RowData["relations"]
    >`${relations.length ? sql`jsonb_build_object(${sql.join(relations, sql`,`)})` : sql`'{}'::jsonb`}`,
  };
}
export async function readRow(
  deps: CommandDependencies,
  rowId: string,
  cols: ColumnDef[],
  conn: Transaction | CommandDependencies["database"] = deps.database,
  fullRelations = false,
) {
  const [row] = await conn
    .select(rowProjection(cols, fullRelations))
    .from(rows)
    .where(eq(rows.id, rowId));
  if (!row) throw new Error("记录不存在");
  return row;
}
