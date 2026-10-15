import { z } from "zod";
import { ServiceError } from "../errors.js";
export async function boundedBody(request: Pick<Request, "body">, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ServiceError(413, { message: "请求内容过大" }); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { reader.releaseLock(); }
}
export function jsonValue(body: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body)); }
  catch { throw new ServiceError(400, { message: "请发送有效的 JSON" }); }
}
export function jsonObject(body: Uint8Array): Record<string, unknown> {
  const value = jsonValue(body);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ServiceError(400, { message: "请发送有效的 JSON 对象" });
  return value as Record<string, unknown>;
}
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(jsonObject(await boundedBody(request, 16 * 1024)));
  if (!result.success) throw new ServiceError(400, { message: "参数不正确" });
  return result.data;
}
export function validUuid(value: string) { if (!z.uuid().safeParse(value).success) throw new ServiceError(404, { message: "资源不存在" }); return value; }
export function webhookBodyLimit(value: number) {
  if (!Number.isInteger(value) || value < 1024 || value > 16 * 1024 * 1024) throw new ServiceError(503, { message: "WEBHOOK_MAX_BODY_BYTES 配置不正确" });
  return value;
}
