import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ObjectStorage } from "@tabdo/storage";
import type { RuntimeDependencies } from "../dependencies.js";
import type { Database } from "../db/types.js";
import { columns, fileObjects, tables } from "../db/schema.js";
import { storedFile } from "../storage/files.js";
import { ServiceError } from "../errors.js";

export type FileCapabilities = Readonly<{
  storage(driver?: "local" | "s3"): ObjectStorage & Readonly<{ driver: "local" | "s3" }>;
  limits: Readonly<{ maxBodyBytes: number; maxFileBytes: number; maxFiles: number }>;
}>;
export type FileDependencies = RuntimeDependencies & FileCapabilities & Readonly<{ logger?: { error(event: string, error: unknown): void } }>;
const uuid = z.uuid();
export const invalidFileId = (id: string) => !uuid.safeParse(id).success;
export async function ownedFileColumn(database: Database, organizationId: string, tableId: string, columnId: string, lock = false) {
  const query = database.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.organizationId, organizationId)));
  const [table] = await (lock ? query.for("update") : query);
  if (!table) throw new ServiceError(404, { message: "表格不存在" });
  const [column] = await database.select().from(columns).where(and(eq(columns.id, columnId), eq(columns.tableId, table.id)));
  if (!column) throw new ServiceError(404, { message: "字段不存在" });
  if (column.type !== "file") throw new ServiceError(400, { message: "此字段不支持文件上传" });
  return column;
}
function fileName(name: string) {
  return Array.from((name.replace(/\\/g, "/").split("/").pop() || "file").replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, 255).join("") || "file";
}
function mimeType(type: string) { return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream"; }
function assertCount(column: typeof columns.$inferSelect, count: number) {
  if (column.config.file?.multiple === false && count > 1) throw new ServiceError(400, { message: "此字段仅允许一个文件" });
}
export async function uploadFiles(deps: FileDependencies, organizationId: string, tableId: string, columnId: string, files: File[]) {
  const column = await ownedFileColumn(deps.database, organizationId, tableId, columnId);
  if (!files.length) throw new ServiceError(400, { message: "请选择文件" });
  if (files.length > deps.limits.maxFiles) throw new ServiceError(400, { message: `每次最多上传 ${deps.limits.maxFiles} 个文件` });
  assertCount(column, files.length);
  if (files.some(file => file.size > deps.limits.maxFileBytes)) throw new ServiceError(413, { message: `单个文件最大 ${deps.limits.maxFileBytes} 字节` });
  const adapter = deps.storage();
  const records = files.map(file => { const id = deps.uuid(); return { id, name: fileName(file.name), size: file.size, mimeType: mimeType(file.type), organizationId, tableId, columnId, storageDriver: adapter.driver, storageKey: `${id.slice(0, 2)}/${id}` }; });
  const attempted: string[] = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const record = records[index]; attempted.push(record.storageKey);
      await adapter.put(record.storageKey, new Uint8Array(await files[index].arrayBuffer()), record.mimeType);
    }
    const saved = await deps.database.transaction(async tx => {
      const current = await ownedFileColumn(tx, organizationId, tableId, columnId, true);
      assertCount(current, files.length);
      return tx.insert(fileObjects).values(records).returning();
    });
    return { files: saved.map(storedFile) };
  } catch (error) {
    const cleanup = await Promise.allSettled(attempted.map(key => adapter.remove(key)));
    if (cleanup.some(result => result.status === "rejected")) deps.logger?.error("file.upload.cleanup failed", records.map(record => record.id));
    if (error instanceof ServiceError) throw error;
    deps.logger?.error("file.upload failed", error instanceof Error ? error.name : "unknown");
    throw new ServiceError(503, { message: "文件上传失败，请重试" });
  }
}
export async function listFiles(deps: RuntimeDependencies, organizationId: string, ids: string[]) {
  if (ids.length > 100 || ids.some(invalidFileId) || new Set(ids).size !== ids.length) throw new ServiceError(400, { message: "文件 ID 参数不正确" });
  const found = await deps.database.select().from(fileObjects).where(and(eq(fileObjects.organizationId, organizationId), inArray(fileObjects.id, ids)));
  if (found.length !== ids.length) throw new ServiceError(404, { message: "文件不存在" });
  const byId = new Map(found.map(record => [record.id, record]));
  return { files: ids.map(id => storedFile(byId.get(id)!)) };
}
export async function downloadFile(deps: FileDependencies, organizationId: string, id: string) {
  if (invalidFileId(id)) throw new ServiceError(404, { message: "文件不存在" });
  const [record] = await deps.database.select().from(fileObjects).where(and(eq(fileObjects.id, id), eq(fileObjects.organizationId, organizationId)));
  if (!record) throw new ServiceError(404, { message: "文件不存在" });
  try { return { record, body: await deps.storage(record.storageDriver).open(record.storageKey) }; }
  catch (error) {
    if ((error as { code?: string }).code === "ENOENT" || (error as Error).name === "NoSuchKey") throw new ServiceError(404, { message: "文件内容不存在" });
    deps.logger?.error("file.download failed", error instanceof Error ? error.name : "unknown");
    throw new ServiceError(503, { message: "文件暂时无法下载，请重试" });
  }
}
