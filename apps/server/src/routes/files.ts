import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Transaction } from "../db/index.js";
import { columns, fileObjects, tables } from "../db/schema.js";
import { requireActorOrg } from "../tenant/http.js";
import { getStorageAdapter, uploadLimits } from "../storage/adapter.js";
import { storedFile } from "../storage/files.js";

export const filesRoute = new Hono();
const uuid = z.uuid();
function invalidId(id: string) { return !uuid.safeParse(id).success; }
async function ownedFileColumn(database: typeof db | Transaction, organizationId: string, tableId: string, columnId: string, lock = false) {
  const query = database.select().from(tables).where(and(eq(tables.id, tableId), eq(tables.organizationId, organizationId)));
  const [table] = await (lock ? query.for("update") : query);
  if (!table) throw new HTTPException(404, { message: "表格不存在" });
  const [column] = await database.select().from(columns).where(and(eq(columns.id, columnId), eq(columns.tableId, table.id)));
  if (!column) throw new HTTPException(404, { message: "字段不存在" });
  if (column.type !== "file") throw new HTTPException(400, { message: "此字段不支持文件上传" });
  return column;
}
/** Always count the stream, including clients with a misleading Content-Length. */
async function boundedMultipart(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new HTTPException(400, { message: "请使用 multipart 文件上传" });
  if (Number(request.headers.get("content-length")) > maxBytes) throw new HTTPException(413, { message: "上传总大小超过限制" });
  if (!request.body) throw new HTTPException(400, { message: "请选择文件" });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HTTPException(413, { message: "上传总大小超过限制" }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw new HTTPException(400, { message: "文件上传格式不正确" }); }
}
function fileName(name: string) {
  return Array.from((name.replace(/\\/g, "/").split("/").pop() || "file").replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, 255).join("") || "file";
}
function mimeType(type: string) { return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream"; }
function assertCount(column: typeof columns.$inferSelect, count: number) {
  if (column.config.file?.multiple === false && count > 1) throw new HTTPException(400, { message: "此字段仅允许一个文件" });
}

filesRoute.post("/tables/:tableId/columns/:columnId/files", async c => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const { tableId, columnId } = c.req.param();
  if (invalidId(tableId) || invalidId(columnId)) return c.json({ error: "表格或字段不存在" }, 404);
  const column = await ownedFileColumn(db, scope.organizationId, tableId, columnId);
  const limits = uploadLimits();
  const form = await boundedMultipart(c.req.raw, limits.maxBodyBytes);
  const uploads = form.getAll("files");
  if (uploads.length === 0 || uploads.some(file => !(file instanceof File))) return c.json({ error: "请选择文件" }, 400);
  if (uploads.length > limits.maxFiles) return c.json({ error: `每次最多上传 ${limits.maxFiles} 个文件` }, 400);
  const files = uploads as File[];
  assertCount(column, files.length);
  if (files.some(file => file.size > limits.maxFileBytes)) return c.json({ error: `单个文件最大 ${limits.maxFileBytes} 字节` }, 413);
  const adapter = getStorageAdapter();
  const records = files.map(file => { const id = randomUUID(); return { id, name: fileName(file.name), size: file.size, mimeType: mimeType(file.type), organizationId: scope.organizationId, tableId, columnId, storageDriver: adapter.driver, storageKey: `${id.slice(0, 2)}/${id}` }; });
  const attempted: string[] = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const record = records[index]; attempted.push(record.storageKey);
      await adapter.put(record.storageKey, new Uint8Array(await files[index].arrayBuffer()), record.mimeType);
    }
    const saved = await db.transaction(async tx => {
      const current = await ownedFileColumn(tx, scope.organizationId, tableId, columnId, true);
      assertCount(current, files.length);
      return tx.insert(fileObjects).values(records).returning();
    });
    return c.json({ files: saved.map(storedFile) }, 201);
  } catch (error) {
    const cleanup = await Promise.allSettled(attempted.map(key => adapter.remove(key)));
    if (cleanup.some(result => result.status === "rejected")) console.error("file.upload.cleanup failed", records.map(record => record.id));
    if (error instanceof HTTPException) throw error;
    console.error("file.upload failed", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "文件上传失败，请重试" }, 503);
  }
});

filesRoute.get("/files", async c => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const ids = (c.req.query("ids") || "").split(",");
  if (ids.length > 100 || ids.some(invalidId) || new Set(ids).size !== ids.length) return c.json({ error: "文件 ID 参数不正确" }, 400);
  const found = await db.select().from(fileObjects).where(and(eq(fileObjects.organizationId, scope.organizationId), inArray(fileObjects.id, ids)));
  if (found.length !== ids.length) return c.json({ error: "文件不存在" }, 404);
  const byId = new Map(found.map(record => [record.id, record]));
  return c.json({ files: ids.map(id => storedFile(byId.get(id)!)) });
});

filesRoute.get("/files/:id/download", async c => {
  const scope = await requireActorOrg(c.req.raw);
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);
  const id = c.req.param("id"); if (invalidId(id)) return c.json({ error: "文件不存在" }, 404);
  const [record] = await db.select().from(fileObjects).where(and(eq(fileObjects.id, id), eq(fileObjects.organizationId, scope.organizationId)));
  if (!record) return c.json({ error: "文件不存在" }, 404);
  try {
    const body = await getStorageAdapter(record.storageDriver).open(record.storageKey);
    const encoded = encodeURIComponent(record.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(body, { headers: { "content-type": record.mimeType, "content-length": String(record.size), "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}`, "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as Error).name === "NoSuchKey") return c.json({ error: "文件内容不存在" }, 404);
    console.error("file.download failed", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "文件暂时无法下载，请重试" }, 503);
  }
});
