import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { ColumnDef, CellValue, StoredFile } from "@tabdo/shared";
import type { Transaction } from "../db/index.js";
import { fileObjects } from "../db/schema.js";

export function storedFile(record: typeof fileObjects.$inferSelect): StoredFile {
  return { id: record.id, name: record.name, size: record.size, mimeType: record.mimeType, createdAt: record.createdAt.toISOString() };
}
/** Called inside the same transaction as a row write, after tenant/column validation. */
export async function assertFileReferences(tx: Transaction, column: ColumnDef, value: CellValue | undefined): Promise<void> {
  if (value === null || value === undefined) return;
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !z.uuid().safeParse(id).success)) throw new HTTPException(400, { message: "文件字段必须是文件 ID 列表" });
  if (new Set(value).size !== value.length) throw new HTTPException(400, { message: "文件字段包含重复文件" });
  if (column.config.file?.multiple === false && value.length > 1) throw new HTTPException(400, { message: "此字段仅允许一个文件" });
  if (value.length === 0) return;
  const found = await tx.select({ id: fileObjects.id }).from(fileObjects).where(and(eq(fileObjects.columnId, column.id), eq(fileObjects.tableId, column.tableId), inArray(fileObjects.id, value)));
  if (found.length !== value.length) throw new HTTPException(400, { message: "文件不存在或不属于此字段" });
}
