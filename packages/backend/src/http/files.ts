import type { Context } from "hono";
import { createRequestRoute, requireActorOrg, type BackendScopeResolver, type BackendEnvironment } from "./request.js";
import * as service from "../services/files.js";
import { ServiceError } from "../errors.js";

/** Count the actual stream even when Content-Length is absent or misleading. */
async function boundedMultipart(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new ServiceError(400, { message: "请使用 multipart 文件上传" });
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ServiceError(413, { message: "上传总大小超过限制" });
  if (!request.body) throw new ServiceError(400, { message: "请选择文件" });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ServiceError(413, { message: "上传总大小超过限制" }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw new ServiceError(400, { message: "文件上传格式不正确" }); }
}
export function createFilesRoute(acquire: BackendScopeResolver) {
  const route = createRequestRoute(acquire);
  const deps = (c: Context<BackendEnvironment>): service.FileDependencies => {
    const scope = c.get("resources");
    if (!scope.files) throw new ServiceError(503, { message: "文件存储未配置" });
    return { ...scope.commands, ...scope.files, logger: scope.logger };
  };
  route.post("/tables/:tableId/columns/:columnId/files", async c => {
    const actor = requireActorOrg(c); if (!actor.ok) return c.json({ error: actor.error }, actor.status);
    const { tableId, columnId } = c.req.param();
    if (service.invalidFileId(tableId) || service.invalidFileId(columnId)) return c.json({ error: "表格或字段不存在" }, 404);
    const resources = deps(c);
    await service.ownedFileColumn(resources.database, actor.organizationId, tableId, columnId);
    const form = await boundedMultipart(c.req.raw, resources.limits.maxBodyBytes), uploads = form.getAll("files");
    if (!uploads.length || uploads.some(file => !(file instanceof File))) return c.json({ error: "请选择文件" }, 400);
    return c.json(await service.uploadFiles(resources, actor.organizationId, tableId, columnId, uploads as File[]), 201);
  });
  route.get("/files", async c => {
    const actor = requireActorOrg(c); if (!actor.ok) return c.json({ error: actor.error }, actor.status);
    return c.json(await service.listFiles(c.get("resources").commands, actor.organizationId, (c.req.query("ids") || "").split(",")));
  });
  route.get("/files/:id/download", async c => {
    const actor = requireActorOrg(c); if (!actor.ok) return c.json({ error: actor.error }, actor.status);
    const { record, body } = await service.downloadFile(deps(c), actor.organizationId, c.req.param("id"));
    const encoded = encodeURIComponent(record.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(body, { headers: { "content-type": record.mimeType, "content-length": String(record.size), "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}`, "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox" } });
  });
  return route;
}
