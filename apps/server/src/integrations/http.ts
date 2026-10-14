import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { z } from "zod";
import * as body from "@tabdo/backend/integrations/body";
import { ServiceError } from "@tabdo/backend/errors";
import { backendCall, mapServiceError } from "../services/backend-facade.js";

/** Node compatibility projections; byte limits and parsing have one shared implementation. */
export async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  return Buffer.from(await backendCall(() => body.boundedBody(request, limit)));
}
export function webhookBodyLimit() {
  try { return body.webhookBodyLimit(Number(process.env.WEBHOOK_MAX_BODY_BYTES ?? 2 * 1024 * 1024)); }
  catch (error) { return mapServiceError(error); }
}
export function jsonValue(bytes: Uint8Array): unknown {
  try { return body.jsonValue(bytes); } catch (error) { return mapServiceError(error); }
}
export function jsonObject(bytes: Uint8Array): Record<string, unknown> {
  try { return body.jsonObject(bytes); } catch (error) { return mapServiceError(error); }
}
export function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  return backendCall(() => body.parseBody(c.req.raw, schema));
}
export function validUuid(value: string) {
  try { return body.validUuid(value); } catch (error) { return mapServiceError(error); }
}
export function integrationError(error: Error, c: Context) {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof ServiceError) return c.json({ error: error.message }, error.status as import("hono/utils/http-status").ContentfulStatusCode);
  console.error("integration.request.failed", error.name);
  return c.json({ error: "集成请求失败，请重试" }, 500);
}
