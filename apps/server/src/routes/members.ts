import { Hono } from "hono";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { DISABLED_TOOLS_SCHEMA } from "@tabdo/shared";
import { getAgentToolCatalog, validateDisabledTools } from "../harness/tool-catalog.js";
import { db } from "../db/index.js";
import { agentProfile, member, user, organization, agentRuns, chatThreads } from "../db/schema.js";
import { auth } from "../auth/index.js";
import { withUserKeyInvitation } from "../auth/key-invitation-context.js";
import { validateSelectedSkills } from "../skills/service.js";
import { avatarImageSchema, botAvatarSchema, memberAvatarUrl } from "../auth/avatar.js";
import {
  listOrgMembers,
  resolveActor,
} from "../auth/actor.js";

export const membersRoute = new Hono();

/** Official adapter metadata plus the same host definitions used by chat. */
membersRoute.get("/agents/tools", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  const selected = z.enum(["pi", "codex", "claude"]).safeParse(c.req.query("harness") ?? "pi");
  if (!selected.success) return c.json({ error: "不支持此 Harness" }, 400);
  return c.json(getAgentToolCatalog(selected.data));
});

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
    return c.json({ error: "成员暂时无法加载，请稍后重试" }, 500);
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
    const createInvitation = () => auth.api.createInvitation({
      body: {
        email: body.email,
        role: body.role,
        organizationId: actor.organizationId,
      },
      headers: c.req.raw.headers,
    });
    const result = actor.kind === "human" && /^bearer tab_/i.test(c.req.header("authorization") ?? "")
      ? await withUserKeyInvitation(actor, createInvitation)
      : await createInvitation();
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
 * In-app agents are created without external API credentials.
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
      image: botAvatarSchema.optional(),
      role: z.enum(["admin", "member"]).default("member"),
      persona: z
        .object({
          systemPrompt: z.string().trim().min(1).max(20_000).optional(),
          skillNames: z.array(z.string().min(1).max(64)).max(80).optional(),
          disabledTools: DISABLED_TOOLS_SCHEMA.optional(),
          defaultHarness: z.enum(["codex", "claude", "pi"]).optional(),
          runtime: z.enum(["local", "sandbox"]).optional(),
          defaultModel: z.string().optional(),
          avatarColor: z.string().optional(),
        })
        .optional(),
    })
    .parse(await c.req.json());

  const id = crypto.randomUUID();
  if (body.persona?.skillNames) {
    try { await validateSelectedSkills(actor.organizationId, body.persona.skillNames); }
    catch (error) { return c.json({ error: (error as Error).message }, 400); }
  }
  const email = `agent+${id.replace(/-/g, "").slice(0, 12)}@agents.local`;

  const memberId = crypto.randomUUID();
  const persona = {
    systemPrompt: body.persona?.systemPrompt,
    skillNames: body.persona?.skillNames,
    disabledTools: body.persona?.disabledTools ?? [],
    defaultHarness: body.persona?.defaultHarness ?? ("pi" as const),
    defaultModel: body.persona?.defaultModel ?? (body.persona?.defaultHarness && body.persona.defaultHarness !== "pi" ? "__harness_default__" : "openrouter/free"),
    runtime: body.persona?.runtime ?? (body.persona?.defaultHarness && body.persona.defaultHarness !== "pi" ? "sandbox" as const : "local" as const),
    avatarColor: body.persona?.avatarColor,
  };
  if (persona.defaultHarness !== "pi" && persona.runtime === "local") return c.json({ error: "本地模式目前只支持 Pi；Codex 和 Claude Code 请使用 Sandbox" }, 400);
  if (persona.defaultHarness !== "pi" && ["openrouter/free", "auto"].includes(persona.defaultModel)) return c.json({ error: "请选择此 Harness 的原生模型或 Harness 默认模型" }, 400);

  persona.disabledTools = validateDisabledTools(persona.defaultHarness, persona.disabledTools);

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id,
      name: body.name,
      email,
      emailVerified: true,
      kind: "agent",
      image: body.image,
    });
    await tx.insert(member).values({
      id: memberId,
      organizationId: actor.organizationId,
      userId: id,
      role: body.role,
    });
    await tx.insert(agentProfile).values({
      userId: id,
      organizationId: actor.organizationId,
      memberId,
      displayName: body.name,
      persona,
    });
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
        image: memberAvatarUrl(memberId, body.image ?? null),
        agent: {
          displayName: body.name,
          persona,
        },
      },
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
      image: botAvatarSchema.optional(),
      persona: z
        .object({
          systemPrompt: z.string().trim().min(1).max(20_000).optional(),
          skillNames: z.array(z.string().min(1).max(64)).max(80).optional(),
          disabledTools: DISABLED_TOOLS_SCHEMA.optional(),
          defaultModel: z.string().optional(),
          avatarColor: z.string().optional(),
          /** Rejected if present and differs — harness locked at create */
          defaultHarness: z.enum(["codex", "claude", "pi"]).optional(),
          runtime: z.enum(["local", "sandbox"]).optional(),
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
    .where(and(eq(agentProfile.userId, mem.userId), eq(agentProfile.organizationId, actor.organizationId), eq(agentProfile.memberId, mem.id)))
    .limit(1);
  if (!profile) return c.json({ error: "不是智能体成员" }, 400);

  const lockedHarness = profile.persona?.defaultHarness ?? ("pi" as const);
  if (body.persona?.skillNames) {
    try { await validateSelectedSkills(actor.organizationId, body.persona.skillNames); }
    catch (error) { return c.json({ error: (error as Error).message }, 400); }
  }
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
          skillNames: body.persona.skillNames ?? profile.persona?.skillNames,
          disabledTools: body.persona.disabledTools ?? profile.persona?.disabledTools,
          runtime: body.persona.runtime ?? profile.persona?.runtime,
          defaultModel:
            body.persona.defaultModel ?? profile.persona?.defaultModel,
          avatarColor:
            body.persona.avatarColor ?? profile.persona?.avatarColor,
        }
      : {}),
    defaultHarness: lockedHarness,
  };
  if (lockedHarness !== "pi" && nextPersona.runtime === "local") return c.json({ error: "本地模式目前只支持 Pi；Codex 和 Claude Code 请使用 Sandbox" }, 400);
  if (lockedHarness !== "pi" && ["openrouter/free", "auto"].includes(nextPersona.defaultModel ?? "")) return c.json({ error: "请选择此 Harness 的原生模型或 Harness 默认模型" }, 400);

  nextPersona.disabledTools = validateDisabledTools(lockedHarness, nextPersona.disabledTools);

  await db.transaction(async (tx) => {
  if (body.name || body.image !== undefined) {
    await tx
      .update(user)
      .set({ ...(body.name ? { name: body.name } : {}), ...(body.image !== undefined ? { image: body.image } : {}), updatedAt: new Date() })
      .where(eq(user.id, mem.userId));
  }
  await tx
    .update(agentProfile)
    .set({
      displayName: body.name ?? profile.displayName,
      persona: nextPersona,
      updatedAt: new Date(),
    })
    .where(eq(agentProfile.userId, mem.userId));
  });

  const members = await listOrgMembers(actor.organizationId);
  const updated = members.find((m) => m.id === memberId);
  return c.json({ ok: true, member: updated });
});

/** Same-org avatars are private; image bytes are not repeated in every member list. */
membersRoute.get("/:memberId/avatar", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  const [target] = await db.select({ image: user.image }).from(member).innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, actor.organizationId))).limit(1);
  if (!target?.image?.startsWith("data:image/")) return c.notFound();
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(target.image);
  if (!match) return c.notFound();
  return new Response(Buffer.from(match[2]!, "base64"), { headers: {
    "Content-Type": match[1]!, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff",
  } });
});

membersRoute.patch("/:memberId/avatar", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  const [target] = await db.select().from(member)
    .where(and(eq(member.id, c.req.param("memberId")), eq(member.organizationId, actor.organizationId))).limit(1);
  if (!target) return c.json({ error: "成员不存在" }, 404);
  if (target.userId !== actor.userId && !["owner", "admin"].includes(String(actor.role))) return c.json({ error: "只能修改自己的头像" }, 403);
  const [bot] = await db.select({ id: agentProfile.id }).from(agentProfile).where(eq(agentProfile.userId, target.userId)).limit(1);
  if (bot) return c.json({ error: "智能体使用 bot 头像，请在智能体配置中修改" }, 400);
  const { image } = z.object({ image: avatarImageSchema }).parse(await c.req.json());
  await db.update(user).set({ image, updatedAt: new Date() }).where(eq(user.id, target.userId));
  return c.json({ ok: true, image: memberAvatarUrl(target.id, image) });
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
  if (mem.role === "owner") {
    return c.json({ error: "不能移除 owner" }, 400);
  }

  await db.transaction(async (tx) => {
    // Delete first to serialize with host tools holding a membership SHARE lock.
    await tx.delete(member).where(and(eq(member.id, memberId), eq(member.organizationId, actor.organizationId)));
    await tx.delete(agentProfile).where(and(
      eq(agentProfile.userId, mem.userId), eq(agentProfile.organizationId, actor.organizationId),
    ));
    const threads = tx.select({ id: chatThreads.id }).from(chatThreads).where(and(
      eq(chatThreads.userId, mem.userId), eq(chatThreads.organizationId, actor.organizationId),
    ));
    await tx.update(agentRuns).set({ cancelRequestedAt: new Date() }).where(and(
      inArray(agentRuns.threadId, threads), inArray(agentRuns.status, ["starting", "running"]),
      isNull(agentRuns.cancelRequestedAt),
    ));
  });
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
