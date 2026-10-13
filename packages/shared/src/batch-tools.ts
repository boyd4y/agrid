import { BATCH_ADD_ROWS_SCHEMA, BATCH_UPDATE_ROWS_SCHEMA, BATCH_DELETE_ROWS_SCHEMA } from "./batch-rows.js";
import { BATCH_ADD_COLUMNS_SCHEMA, BATCH_UPDATE_COLUMNS_SCHEMA, BATCH_DELETE_COLUMNS_SCHEMA } from "./batch-columns.js";
import { BATCH_SET_RELATIONS_SCHEMA, BATCH_ADD_RELATIONS_SCHEMA, BATCH_REMOVE_RELATIONS_SCHEMA } from "./batch-relations.js";

export const BATCH_TOOLS = {
  batch_add_rows: { command: "batchAddRows", schema: BATCH_ADD_ROWS_SCHEMA, description: "一次性批量新增1–100条记录，用于导入或生成mock示例数据。先get_table读取字段UUID和选项id；cells以字段UUID为键。公式、汇总只读。整批失败回滚，返回count、rowIds、affectedTableIds；超过100条分批写入。" },
  batch_update_rows: { command: "batchUpdateRows", schema: BATCH_UPDATE_ROWS_SCHEMA, description: "批量修改1–100条已有记录，仅patch指定cells，保留无关值。可逐条传expectedVersion防覆盖并发修改；整批失败回滚，返回count、rowIds、affectedTableIds。" },
  batch_delete_rows: { command: "batchDeleteRows", schema: BATCH_DELETE_ROWS_SCHEMA, description: "按UUID批量删除1–100条记录，同时清理关联。仅在用户要求删除时使用；整批失败回滚。" },
  batch_add_columns: { command: "batchAddColumns", schema: BATCH_ADD_COLUMNS_SCHEMA, description: "在同一表批量新增1–100个字段。字段选项、公式、relation、rollup放在config中；支持双向关联inverseName。所有字段及关联在同一事务创建，失败回滚。" },
  batch_update_columns: { command: "batchUpdateColumns", schema: BATCH_UPDATE_COLUMNS_SCHEMA, description: "按columnId批量修改1–100个字段的名称、类型、config、宽度、顺序或隐藏状态。类型转换和公式重算在同一事务，失败回滚。" },
  batch_delete_columns: { command: "batchDeleteColumns", schema: BATCH_DELETE_COLUMNS_SCHEMA, description: "按UUID批量删除1–100个字段，保留原有依赖校验；整批失败回滚。仅在用户要求删除时使用。" },
  batch_set_relations: { command: "batchSetRelations", schema: BATCH_SET_RELATIONS_SCHEMA, description: "批量替换1–100个记录关联字段的目标记录UUID数组。字段必须已存在，recordIds=[]清空关联；可传expectedVersion。整批失败回滚，不删除记录。" },
  batch_add_relations: { command: "batchAddRelations", schema: BATCH_ADD_RELATIONS_SCHEMA, description: "批量向1–100个已有记录关联字段增量添加目标记录UUID，幂等保留其他关联，可传expectedVersion。整批失败回滚。创建关联字段用batch_add_columns。" },
  batch_remove_relations: { command: "batchRemoveRelations", schema: BATCH_REMOVE_RELATIONS_SCHEMA, description: "批量从1–100个已有记录关联字段解除指定目标UUID，保留其他关联，可传expectedVersion。整批失败回滚，不删除记录或字段。" },
} as const;

/** Keep model payloads bounded; complete records remain available through get_row. */
export function batchToolResult(name: string, result: unknown): unknown {
  if ((name === "batch_set_relations" || name === "batch_add_relations" || name === "batch_remove_relations") && result && typeof result === "object" && "rows" in result) {
    const value = result as { count: number; rows: { id: string }[]; affectedTableIds: string[] };
    return { count: value.count, rowIds: value.rows.map(row => row.id), affectedTableIds: value.affectedTableIds };
  }
  return result;
}
