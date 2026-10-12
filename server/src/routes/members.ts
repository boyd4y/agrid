import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { agentProfile, member, user, organization } from "../db/schema.js";
import { auth } from "../auth/index.js";
import {
  generateApiKey,
  listOrgMembers,
  resolveActor,
} from "../auth/actor.js";

export const membersRoute = new Hono();

/** Unified member list — humans + agents, equal shape */
membersRoute.get("/", async (c) => {
  try {
    const actor = await resolveActor(c.req.raw);
    if (!actor?.organizationId) {
      // Dev-friendly: empty list so person picker still works offline
      return c.json({ organizationId: null, members: [], actor: actor ?? null });
    }
    const members = await listOrgMembers(actor.organizationId);
    return c.json({ organizationId: actor.organizationId, members, actor });
  } catch (e) {
    console.warn("members list", e);
    return c.json({ organizationId: null, members: [], actor: null });
  }
});

/** Invite human via Better Auth organization + Resend */
membersRoute.post("/invite", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  if (!["owner", "admin"].includes(String(actor.role))) {
    return c.json({ error: "仅 owner/admin 可邀请" }, 403);
  }

  const body = z
    .object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]).default("member"),
    })
    .parse(await c.req.json());

  try {
    const result = await auth.api.createInvitation({
      body: {
        email: body.email,
        role: body.role,
        organizationId: actor.organizationId,
      },
      headers: c.req.raw.headers,
    });
    return c.json({ ok: true, invitation: result });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "邀请失败" },
      400
    );
  }
});

/**
 * Create agent member — same org membership + role as humans.
 * Returns one-time API key (agt_...).
 */
membersRoute.post("/agents", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  if (!["owner", "admin"].includes(String(actor.role))) {
    return c.json({ error: "仅 owner/admin 可创建 Agent" }, 403);
  }

  const body = z
    .object({
      name: z.string().min(1).max(100),
      role: z.enum(["admin", "member"]).default("member"),
      persona: z
        .object({
          systemPrompt: z.string().optional(),
          defaultHarness: z.enum(["codex", "claude", "pi"]).optional(),
          defaultModel: z.string().optional(),
          avatarColor: z.string().optional(),
        })
        .optional(),
    })
    .parse(await c.req.json());

  const id = crypto.randomUUID();
  const email = `agent+${id.replace(/-/g, "").slice(0, 12)}@agents.local`;
  const { raw, hash, prefix } = generateApiKey();

  await db.insert(user).values({
    id,
    name: body.name,
    email,
    emailVerified: true,
    kind: "agent",
  });

  const memberId = crypto.randomUUID();
  await db.insert(member).values({
    id: memberId,
    organizationId: actor.organizationId,
    userId: id,
    role: body.role,
  });

  const persona = {
    systemPrompt: body.persona?.systemPrompt,
    defaultHarness: body.persona?.defaultHarness ?? ("pi" as const),
    defaultModel: body.persona?.defaultModel ?? "openrouter/free",
    avatarColor: body.persona?.avatarColor,
  };

  await db.insert(agentProfile).values({
    userId: id,
    organizationId: actor.organizationId,
    memberId,
    displayName: body.name,
    persona,
    apiKeyHash: hash,
    apiKeyPrefix: prefix,
  });

  return c.json(
    {
      ok: true,
      member: {
        id: memberId,
        userId: id,
        name: body.name,
        email,
        kind: "agent" as const,
        role: body.role,
        agent: {
          displayName: body.name,
          persona,
          apiKeyPrefix: prefix,
        },
      },
      /** shown once */
      apiKey: raw,
    },
    201
  );
});


/**
 * Update agent name / persona. Harness is immutable after create (UI + API).
 */
membersRoute.patch("/agents/:memberId", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  if (!["owner", "admin"].includes(String(actor.role))) {
    return c.json({ error: "仅 owner/admin 可编辑 Agent" }, 403);
  }

  const memberId = c.req.param("memberId");
  const body = z
    .object({
      name: z.string().min(1).max(100).optional(),
      persona: z
        .object({
          systemPrompt: z.string().optional(),
          defaultModel: z.string().optional(),
          avatarColor: z.string().optional(),
          /** Rejected if present and differs — harness locked at create */
          defaultHarness: z.enum(["codex", "claude", "pi"]).optional(),
        })
        .optional(),
    })
    .parse(await c.req.json());

  const [mem] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.id, memberId),
        eq(member.organizationId, actor.organizationId)
      )
    )
    .limit(1);
  if (!mem) return c.json({ error: "成员不存在" }, 404);

  const [profile] = await db
    .select()
    .from(agentProfile)
    .where(eq(agentProfile.userId, mem.userId))
    .limit(1);
  if (!profile) return c.json({ error: "不是智能体成员" }, 400);

  const lockedHarness = profile.persona?.defaultHarness ?? ("pi" as const);
  if (
    body.persona?.defaultHarness !== undefined &&
    body.persona.defaultHarness !== lockedHarness
  ) {
    return c.json(
      { error: "Harness 创建后不可更换。请新建智能体并选择其他 Harness。" },
      400
    );
  }

  const nextPersona = {
    ...(profile.persona ?? {}),
    ...(body.persona
      ? {
          systemPrompt:
            body.persona.systemPrompt ?? profile.persona?.systemPrompt,
          defaultModel:
            body.persona.defaultModel ?? profile.persona?.defaultModel,
          avatarColor:
            body.persona.avatarColor ?? profile.persona?.avatarColor,
        }
      : {}),
    defaultHarness: lockedHarness,
  };

  if (body.name) {
    await db
      .update(user)
      .set({ name: body.name })
      .where(eq(user.id, mem.userId));
  }
  await db
    .update(agentProfile)
    .set({
      displayName: body.name ?? profile.displayName,
      persona: nextPersona,
      updatedAt: new Date(),
    })
    .where(eq(agentProfile.userId, mem.userId));

  const members = await listOrgMembers(actor.organizationId);
  const updated = members.find((m) => m.id === memberId);
  return c.json({ ok: true, member: updated });
});

membersRoute.delete("/:memberId", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  if (!["owner", "admin"].includes(String(actor.role))) {
    return c.json({ error: "权限不足" }, 403);
  }

  const memberId = c.req.param("memberId");
  const [mem] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.id, memberId),
        eq(member.organizationId, actor.organizationId)
      )
    )
    .limit(1);
  if (!mem) return c.json({ error: "成员不存在" }, 404);
  if (mem.userId === actor.userId) {
    return c.json({ error: "不能移除自己" }, 400);
  }

  // cascade: deleting user removes agent_profile & membership
  await db.delete(user).where(eq(user.id, mem.userId));
  return c.json({ ok: true });
});

membersRoute.get("/me", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor) return c.json({ error: "未登录" }, 401);
  let org = null;
  if (actor.organizationId) {
    const [o] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, actor.organizationId))
      .limit(1);
    org = o ?? null;
  }
  return c.json({ actor, organization: org });
});
