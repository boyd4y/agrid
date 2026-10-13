import { z } from "zod";
import { COLUMN_TYPES, type ColumnDef } from "./types.js";

export const COLUMN_CONFIG_SCHEMA = z.object({
  file: z.object({ multiple: z.boolean().optional() }).strict().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string(), color: z.string().optional() })).optional(),
  hidden: z.boolean().optional(),
  formula: z.string().optional(),
  formulaResultType: z.enum(["auto", "number", "text", "checkbox", "date"]).optional(),
  dateFormat: z.enum(["YYYY-MM-DD", "YYYY/MM/DD", "MM/DD/YYYY", "DD/MM/YYYY", "MMM D, YYYY"]).optional(),
  relation: z.object({
    relationId: z.string().uuid().optional(), direction: z.enum(["source", "target"]).optional(),
    targetTableId: z.string().uuid(), limit: z.enum(["one", "many"]).optional(),
    inverseName: z.string().trim().min(1).max(100).optional(), inverseLimit: z.enum(["one", "many"]).optional(),
  }).optional(),
  rollup: z.object({
    relationColumnId: z.string().uuid(), targetColumnId: z.string().uuid().optional(),
    operation: z.enum(["count", "sum", "average", "min", "max", "earliest", "latest"]),
  }).optional(),
}).strict();
export const ADD_COLUMN_SCHEMA = z.object({
  tableId: z.string().uuid(), name: z.string().trim().min(1).max(100), type: z.enum(COLUMN_TYPES),
  config: COLUMN_CONFIG_SCHEMA.optional(), width: z.number().int().positive().optional(),
}).strict();
export const UPDATE_COLUMN_SCHEMA = ADD_COLUMN_SCHEMA.omit({ tableId: true }).partial().extend({
  columnId: z.string().uuid(), sortOrder: z.number().int().optional(), hidden: z.boolean().optional(),
}).strict();
export const BATCH_ADD_COLUMNS_SCHEMA = z.object({
  tableId: z.string().uuid(), columns: z.array(ADD_COLUMN_SCHEMA.omit({ tableId: true })).min(1).max(100),
}).strict();
export const BATCH_UPDATE_COLUMNS_SCHEMA = z.object({
  columns: z.array(UPDATE_COLUMN_SCHEMA).min(1).max(100)
    .refine((columns) => new Set(columns.map((c) => c.columnId)).size === columns.length, "字段不能重复"),
}).strict();
export const BATCH_DELETE_COLUMNS_SCHEMA = z.object({
  columnIds: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "字段不能重复"),
}).strict();
export type BatchAddColumnsInput = z.infer<typeof BATCH_ADD_COLUMNS_SCHEMA>;
export type BatchUpdateColumnsInput = z.infer<typeof BATCH_UPDATE_COLUMNS_SCHEMA>;
export type BatchDeleteColumnsInput = z.infer<typeof BATCH_DELETE_COLUMNS_SCHEMA>;
export type BatchColumnsResult = { count: number; columns: ColumnDef[]; affectedTableIds: string[] };
export type BatchDeleteColumnsResult = { count: number; columnIds: string[]; affectedTableIds: string[] };
