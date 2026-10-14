import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import { hashApiKey } from "../auth/actor.js";
import type { RuntimeDependencies } from "../dependencies.js";
import { userApiKeys } from "../db/schema.js";
import { ServiceError } from "../errors.js";

function assertHuman(actor: Actor) {
  if (!actor.organizationId) throw new ServiceError(401, { message: "请登录并选择工作区" });
  if (actor.kind !== "human") throw new ServiceError(403, { message: "仅用户可管理个人 API Key" });
}
const summary = (record: typeof userApiKeys.$inferSelect) => ({ id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt.toISOString() });
export async function listApiKeys(deps: RuntimeDependencies, actor: Actor) {
  assertHuman(actor);
  const records = await deps.database.select().from(userApiKeys).where(and(eq(userApiKeys.userId, actor.userId), eq(userApiKeys.organizationId, actor.organizationId), isNull(userApiKeys.revokedAt))).orderBy(desc(userApiKeys.createdAt), desc(userApiKeys.id));
  return { keys: records.map(summary) };
}
export async function createApiKey(deps: RuntimeDependencies, actor: Actor, input: unknown) {
  assertHuman(actor);
  const body = z.strictObject({ name: z.string().trim().min(1).max(100) }).safeParse(input);
  if (!body.success) throw new ServiceError(400, { message: "请输入有效的 Key 名称（最多100字）" });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `tab_${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  const [record] = await deps.database.insert(userApiKeys).values({ userId: actor.userId, organizationId: actor.organizationId, name: body.data.name, keyHash: await hashApiKey(secret), prefix: secret.slice(0, 12) }).returning();
  return { key: summary(record), secret };
}
export async function deleteApiKey(deps: RuntimeDependencies, actor: Actor, value: string) {
  assertHuman(actor);
  const id = z.uuid().safeParse(value);
  if (!id.success) throw new ServiceError(404, { message: "API Key 不存在" });
  const [record] = await deps.database.delete(userApiKeys).where(and(eq(userApiKeys.id, id.data), eq(userApiKeys.userId, actor.userId), eq(userApiKeys.organizationId, actor.organizationId))).returning({ id: userApiKeys.id });
  if (!record) throw new ServiceError(404, { message: "API Key 不存在" });
  return { id: record.id };
}
