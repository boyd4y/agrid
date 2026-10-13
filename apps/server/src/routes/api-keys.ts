import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { userApiKeys } from "../db/schema.js";
import { hashApiKey, resolveActor, type Actor } from "../auth/actor.js";

export const apiKeysRoute = new Hono<{ Variables: { actor: Actor } }>();
function summary(record: typeof userApiKeys.$inferSelect) {
  return { id: record.id, name: record.name, prefix: record.prefix, createdAt: record.createdAt.toISOString(), revokedAt: record.revokedAt?.toISOString() ?? null };
}
apiKeysRoute.use("*", async (c, next) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "请登录并选择工作区" }, 401);
  if (actor.kind !== "human") return c.json({ error: "仅用户可管理个人 API Key" }, 403);
  c.set("actor", actor);
  c.header("Cache-Control", "private, no-store");
  await next();
});
apiKeysRoute.get("/", async c => {
  const actor = c.get("actor");
  const records = await db.select().from(userApiKeys).where(and(eq(userApiKeys.userId, actor.userId), eq(userApiKeys.organizationId, actor.organizationId))).orderBy(desc(userApiKeys.createdAt), desc(userApiKeys.id));
  return c.json({ keys: records.map(summary) });
});
apiKeysRoute.post("/", async c => {
  const actor = c.get("actor");
  const body = z.strictObject({ name: z.string().trim().min(1).max(100) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "请输入有效的 Key 名称（最多100字）" }, 400);
  const raw = `tab_${randomBytes(32).toString("base64url")}`;
  const [record] = await db.insert(userApiKeys).values({ userId: actor.userId, organizationId: actor.organizationId, name: body.data.name, keyHash: hashApiKey(raw), prefix: raw.slice(0, 12) }).returning();
  return c.json({ key: summary(record), secret: raw }, 201);
});
apiKeysRoute.delete("/:id", async c => {
  const actor = c.get("actor");
  const id = z.uuid().safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "API Key 不存在" }, 404);
  const [record] = await db.update(userApiKeys).set({ revokedAt: new Date() }).where(and(eq(userApiKeys.id, id.data), eq(userApiKeys.userId, actor.userId), eq(userApiKeys.organizationId, actor.organizationId))).returning();
  if (!record) return c.json({ error: "API Key 不存在" }, 404);
  return c.json({ key: summary(record) });
});
