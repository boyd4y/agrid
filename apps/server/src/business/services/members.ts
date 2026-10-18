import { eq, and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_DISABLED_PLATFORM_TOOLS, DISABLED_TOOLS_SCHEMA, sandboxProviderSchema, type SkillDocument, type AgentToolCatalog } from "@tabdo/shared";
import type { RuntimeDependencies } from "../dependencies.js";
import { ServiceError } from "../errors.js";
import { agentProfile, member, user, organization, agentRuns, chatThreads } from "../db/schema.js";
import { validateDisabledTools } from "./tool-settings.js";
import { validateSelectedSkills } from "../skills/service.js";
import { avatarImageSchema, botAvatarSchema } from "../auth/avatar-validation.js";
import { memberAvatarUrl } from "../auth/avatar.js";
import { listOrgMembers, type Actor } from "../auth/actor.js";
import { NATIVE_DEFAULT_MODEL } from "../agent/contracts.js";

export type MemberDependencies = RuntimeDependencies & Readonly<{
 builtinSkills?: readonly SkillDocument[];
 toolCatalog?(harness: "pi" | "codex" | "claude"): AgentToolCatalog;
 invite?(actor: Actor, input: {email:string; role:"admin"|"member"}, headers: Headers): Promise<unknown>;
 logger?: Readonly<{ error(event:string,error:unknown): void }>;
}>;

async function checkSkills(deps: MemberDependencies, org: string, names: string[]) {
 if (!deps.builtinSkills) throw new ServiceError(503, {message:"内置技能目录未配置"});
 return validateSelectedSkills({...deps,builtins:deps.builtinSkills},org,names);
}
function toolCatalog(deps:MemberDependencies,harness:"pi"|"codex"|"claude") {
 if (!deps.toolCatalog) throw new ServiceError(503,{message:"工具目录未配置"});
 return deps.toolCatalog(harness);
}

export async function getToolCatalog(deps: MemberDependencies, actor: Actor, raw?: string) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  const selected = z.enum(["pi", "codex", "claude"]).safeParse(raw ?? "pi");
  if (!selected.success) throw new ServiceError(400, {message: "不支持此 Harness"});
  return toolCatalog(deps, selected.data);
}

export async function listMembers(deps: MemberDependencies, actor: Actor) {
  try {
      if (!actor?.organizationId) {
      throw new ServiceError(401, {message:"未授权"});
    }
    const members = await listOrgMembers(actor.organizationId, deps);
    return { organizationId: actor.organizationId, members, actor };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    deps.logger?.error("members list", e);
    throw new ServiceError(500, {message: "成员暂时无法加载，请稍后重试"});
  }
}

export async function inviteMember(deps: MemberDependencies, actor: Actor, raw: unknown, headers: Headers) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  if (!["owner", "admin"].includes(String(actor.role))) {
    throw new ServiceError(403, {message: "仅 owner/admin 可邀请"});
  }

  const body = z
    .object({
      email: z.string().email(),
      role: z.enum(["admin", "member"]).default("member"),
    })
    .parse(raw);

  try {
    if (!deps.invite) throw new ServiceError(503, { message: "邀请服务未配置" });
    const result = await deps.invite(actor, body, headers);
    return { ok: true, invitation: result };
  } catch (e) {
    throw new ServiceError(400, {message: e instanceof Error ? e.message : "邀请失败"});
  }
}

export async function createAgent(deps: MemberDependencies, actor: Actor, raw: unknown) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  if (!["owner", "admin"].includes(String(actor.role))) {
    throw new ServiceError(403, {message: "仅 owner/admin 可创建 Agent"});
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
          sandboxProvider: sandboxProviderSchema.optional(),
          defaultModel: z.string().optional(),
          avatarColor: z.string().optional(),
        })
        .optional(),
    })
    .parse(raw);

  const id = deps.uuid();
  if (body.persona?.skillNames) {
    try { await checkSkills(deps, actor.organizationId, body.persona.skillNames); }
    catch (error) { throw new ServiceError(400, {message: (error as Error).message}); }
  }
  const email = `agent+${id.replace(/-/g, "").slice(0, 12)}@agents.local`;

  const memberId = deps.uuid();
  const persona = {
    systemPrompt: body.persona?.systemPrompt,
    skillNames: body.persona?.skillNames,
    disabledTools: body.persona?.disabledTools ?? [...DEFAULT_DISABLED_PLATFORM_TOOLS],
    defaultHarness: body.persona?.defaultHarness ?? ("pi" as const),
    defaultModel: body.persona?.defaultModel?.trim() || NATIVE_DEFAULT_MODEL,
    runtime: body.persona?.runtime ?? (body.persona?.defaultHarness && body.persona.defaultHarness !== "pi" ? "sandbox" as const : "local" as const),
    sandboxProvider: body.persona?.sandboxProvider,
    avatarColor: body.persona?.avatarColor,
  };
  if (persona.defaultHarness !== "pi" && ["openrouter/free", "auto"].includes(persona.defaultModel)) throw new ServiceError(400, {message: "请选择此 Harness 的原生模型或 Harness 默认模型"});

  persona.disabledTools = validateDisabledTools(persona.defaultHarness, persona.disabledTools);

  await deps.database.transaction(async (tx) => {
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

  return {
      ok: true,
      member: {
        id: memberId,
        userId: id,
        name: body.name,
        email,
        kind: "agent" as const,
        role: body.role,
        image: await memberAvatarUrl(memberId, body.image ?? null),
        agent: {
          displayName: body.name,
          persona,
        },
      },
    };
}

export async function updateAgent(deps: MemberDependencies, actor: Actor, raw: unknown, targetMemberId: string) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  if (!["owner", "admin"].includes(String(actor.role))) {
    throw new ServiceError(403, {message: "仅 owner/admin 可编辑 Agent"});
  }

  const memberId = targetMemberId;
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
          sandboxProvider: sandboxProviderSchema.optional(),
        })
        .optional(),
    })
    .parse(raw);

  const [mem] = await deps.database
    .select()
    .from(member)
    .where(
      and(
        eq(member.id, memberId),
        eq(member.organizationId, actor.organizationId)
      )
    )
    .limit(1);
  if (!mem) throw new ServiceError(404, {message: "成员不存在"});

  const [profile] = await deps.database
    .select()
    .from(agentProfile)
    .where(and(eq(agentProfile.userId, mem.userId), eq(agentProfile.organizationId, actor.organizationId), eq(agentProfile.memberId, mem.id)))
    .limit(1);
  if (!profile) throw new ServiceError(400, {message: "不是智能体成员"});

  const lockedHarness = profile.persona?.defaultHarness ?? ("pi" as const);
  if (body.persona?.skillNames) {
    try { await checkSkills(deps, actor.organizationId, body.persona.skillNames); }
    catch (error) { throw new ServiceError(400, {message: (error as Error).message}); }
  }
  if (
    body.persona?.defaultHarness !== undefined &&
    body.persona.defaultHarness !== lockedHarness
  ) {
    throw new ServiceError(400, {message: "Harness 创建后不可更换。请新建智能体并选择其他 Harness。"});
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
          sandboxProvider: body.persona.sandboxProvider ?? profile.persona?.sandboxProvider,
          defaultModel:
            body.persona.defaultModel ?? profile.persona?.defaultModel,
          avatarColor:
            body.persona.avatarColor ?? profile.persona?.avatarColor,
        }
      : {}),
    defaultHarness: lockedHarness,
  };
  if (lockedHarness !== "pi" && ["openrouter/free", "auto"].includes(nextPersona.defaultModel ?? "")) throw new ServiceError(400, {message: "请选择此 Harness 的原生模型或 Harness 默认模型"});

  nextPersona.disabledTools = validateDisabledTools(lockedHarness, nextPersona.disabledTools);

  await deps.database.transaction(async (tx) => {
  if (body.name || body.image !== undefined) {
    await tx
      .update(user)
      .set({ ...(body.name ? { name: body.name } : {}), ...(body.image !== undefined ? { image: body.image } : {}), updatedAt: deps.now() })
      .where(eq(user.id, mem.userId));
  }
  await tx
    .update(agentProfile)
    .set({
      displayName: body.name ?? profile.displayName,
      persona: nextPersona,
      updatedAt: deps.now(),
    })
    .where(eq(agentProfile.userId, mem.userId));
  });

  const members = await listOrgMembers(actor.organizationId, deps);
  const updated = members.find((m) => m.id === memberId);
  return { ok: true, member: updated };
}

export async function getMemberAvatar(deps: MemberDependencies, actor: Actor, targetMemberId: string) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  const [target] = await deps.database.select({ image: user.image }).from(member).innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.id, targetMemberId), eq(member.organizationId, actor.organizationId))).limit(1);
  if (!target?.image?.startsWith("data:image/")) throw new ServiceError(404, {message:"头像不存在"});
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(target.image);
  if (!match) throw new ServiceError(404, {message:"头像不存在"});
  return { bytes: Uint8Array.from(atob(match[2]!), character => character.charCodeAt(0)), mimeType: match[1]! };
}

export async function updateMemberAvatar(deps: MemberDependencies, actor: Actor, raw: unknown, targetMemberId: string) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  const [target] = await deps.database.select().from(member)
    .where(and(eq(member.id, targetMemberId), eq(member.organizationId, actor.organizationId))).limit(1);
  if (!target) throw new ServiceError(404, {message: "成员不存在"});
  if (target.userId !== actor.userId && !["owner", "admin"].includes(String(actor.role))) throw new ServiceError(403, {message: "只能修改自己的头像"});
  const [bot] = await deps.database.select({ id: agentProfile.id }).from(agentProfile).where(eq(agentProfile.userId, target.userId)).limit(1);
  if (bot) throw new ServiceError(400, {message: "智能体使用 bot 头像，请在智能体配置中修改"});
  const { image } = z.object({ image: avatarImageSchema }).parse(raw);
  await deps.database.update(user).set({ image, updatedAt: deps.now() }).where(eq(user.id, target.userId));
  return { ok: true, image: await memberAvatarUrl(target.id, image) };
}

export async function deleteMember(deps: MemberDependencies, actor: Actor, targetMemberId: string) {
  if (!actor?.organizationId) throw new ServiceError(401, {message: "未授权"});
  if (!["owner", "admin"].includes(String(actor.role))) {
    throw new ServiceError(403, {message: "权限不足"});
  }

  const memberId = targetMemberId;
  const [mem] = await deps.database
    .select()
    .from(member)
    .where(
      and(
        eq(member.id, memberId),
        eq(member.organizationId, actor.organizationId)
      )
    )
    .limit(1);
  if (!mem) throw new ServiceError(404, {message: "成员不存在"});
  if (mem.userId === actor.userId) {
    throw new ServiceError(400, {message: "不能移除自己"});
  }
  if (mem.role === "owner") {
    throw new ServiceError(400, {message: "不能移除 owner"});
  }

  await deps.database.transaction(async (tx) => {
    // Delete first to serialize with host tools holding a membership SHARE lock.
    await tx.delete(member).where(and(eq(member.id, memberId), eq(member.organizationId, actor.organizationId)));
    await tx.delete(agentProfile).where(and(
      eq(agentProfile.userId, mem.userId), eq(agentProfile.organizationId, actor.organizationId),
    ));
    const threads = tx.select({ id: chatThreads.id }).from(chatThreads).where(and(
      eq(chatThreads.userId, mem.userId), eq(chatThreads.organizationId, actor.organizationId),
    ));
    await tx.update(agentRuns).set({ cancelRequestedAt: deps.now() }).where(and(
      inArray(agentRuns.threadId, threads), inArray(agentRuns.status, ["starting", "running"]),
      isNull(agentRuns.cancelRequestedAt),
    ));
  });
  return { ok: true };
}

export async function getMe(deps: MemberDependencies, actor: Actor) {
  if (!actor) throw new ServiceError(401, {message: "未登录"});
  let org = null;
  if (actor.organizationId) {
    const [o] = await deps.database
      .select()
      .from(organization)
      .where(eq(organization.id, actor.organizationId))
      .limit(1);
    org = o ?? null;
  }
  return { actor, organization: org };
}
