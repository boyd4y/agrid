import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { z } from "zod";

/** Bound actual bytes, including chunked or misleading Content-Length bodies. */
export async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const reader = request.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HTTPException(413, { message: "请求内容过大" }); }
      chunks.push(result.value);
    }
    return Buffer.concat(chunks, size);
  } finally { reader.releaseLock(); }
}
export function webhookBodyLimit() {
  const value = Number(process.env.WEBHOOK_MAX_BODY_BYTES ?? 2 * 1024 * 1024);
  if (!Number.isInteger(value) || value < 1024 || value > 16 * 1024 * 1024) throw new HTTPException(503, { message: "WEBHOOK_MAX_BODY_BYTES 配置不正确" });
  return value;
}
export function jsonValue(body: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new HTTPException(400, { message: "请发送有效的 JSON" }); }
}
export function jsonObject(body: Buffer): Record<string, unknown> {
  try {
    const value = jsonValue(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object expected");
    return value as Record<string, unknown>;
  } catch { throw new HTTPException(400, { message: "请发送有效的 JSON 对象" }); }
}
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(jsonObject(await boundedBody(c.req.raw, 16 * 1024)));
  if (!result.success) throw new HTTPException(400, { message: "参数不正确" });
  return result.data;
}
export function validUuid(value: string) { if (!z.uuid().safeParse(value).success) throw new HTTPException(404, { message: "资源不存在" }); return value; }
export function integrationError(error: Error, c: Context) {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  // Never log raw request bodies, provider response bodies or encrypted records.
  console.error("integration.request.failed", error.name);
  return c.json({ error: "集成请求失败，请重试" }, 500);
}
