import { z } from "zod";

const cells = z.record(z.string().uuid(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]));
export const BATCH_ADD_ROWS_SCHEMA = z.object({
  tableId: z.string().uuid(), rows: z.array(z.object({ cells: cells.optional() }).strict()).min(1).max(100),
}).strict();
export const BATCH_UPDATE_ROWS_SCHEMA = z.object({
  updates: z.array(z.object({ rowId: z.string().uuid(), cells, expectedVersion: z.number().int().positive().optional() }).strict()).min(1).max(100)
    .refine(updates => new Set(updates.map(update => update.rowId)).size === updates.length, "记录不能重复"),
}).strict();
export const BATCH_DELETE_ROWS_SCHEMA = z.object({
  rowIds: z.array(z.string().uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "记录不能重复"),
}).strict();
