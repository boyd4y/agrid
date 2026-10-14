import { and, eq } from "drizzle-orm";
import { MEMBER_LIST_SCHEMA } from "@tabdo/shared";
import { db } from "../db/index.js";
import { organization, member, user } from "../db/schema.js";
import { listOrgMembers } from "../auth/actor.js";
import { requireOrgId } from "../tenant/scope.js";

type Scope = { organizationId?: string; actorId?: string };
async function currentActor(input: Scope) {
  const organizationId = requireOrgId(input.organizationId);
  if (!input.actorId) return { organizationId, actor: null };
  const [actor] = await db.select({ userId: user.id, memberId: member.id, name: user.name, email: user.email, kind: user.kind, role: member.role })
    .from(member).innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, input.actorId))).limit(1);
  if (!actor) throw new Error("当前成员不属于该工作区");
  return { organizationId, actor };
}

/** Trusted caller scope only. Never accept an organization ID from a model tool schema. */
export async function getWorkspace(input: Scope) {
  const { organizationId, actor } = await currentActor(input);
  const [workspace] = await db.select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!workspace) throw new Error("工作区不存在");
  return { workspace, actor };
}

/** Same member identities as the UI; person fields and agent actions use userId. */
export async function listMembers(input: Scope & { kind?: "human" | "agent"; search?: string; offset?: number; limit?: number }) {
  const options = MEMBER_LIST_SCHEMA.parse({ kind: input.kind, search: input.search, offset: input.offset, limit: input.limit });
  const { organizationId } = await currentActor(input);
  const search = options.search?.toLocaleLowerCase();
  const members = (await listOrgMembers(organizationId)).filter(item =>
    (!options.kind || item.kind === options.kind) && (!search || [item.name, item.email, item.agent?.displayName].some(value => value?.toLocaleLowerCase().includes(search))));
  members.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  return { organizationId, members: members.slice(options.offset, options.offset + options.limit), total: members.length,
    offset: options.offset, hasMore: options.offset + options.limit < members.length,
    identityField: "userId", usage: "负责人/person 字段填成员 userId；智能体动作 agentUserId 填 kind=agent 的 userId。id 是成员记录 ID，不能代替 userId。" };
}
