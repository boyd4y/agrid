import { z } from "zod";
import type { RowData } from "./types.js";

export const RELATION_WRITE_SCHEMA = z.object({
  rowId: z.string().uuid(), columnId: z.string().uuid(), recordIds: z.array(z.string().uuid()).max(1000),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();
export const BATCH_SET_RELATIONS_SCHEMA = z.object({
  relations: z.array(RELATION_WRITE_SCHEMA).min(1).max(100)
    .refine((relations) => new Set(relations.map((r) => `${r.rowId}:${r.columnId}`)).size === relations.length, "记录关联字段不能重复"),
}).strict();
export const BATCH_ADD_RELATIONS_SCHEMA = BATCH_SET_RELATIONS_SCHEMA;
export const BATCH_REMOVE_RELATIONS_SCHEMA = BATCH_SET_RELATIONS_SCHEMA;
export type BatchRelationsInput = z.infer<typeof BATCH_SET_RELATIONS_SCHEMA>;
export type BatchRelationsResult = { count: number; rows: RowData[]; affectedTableIds: string[] };
