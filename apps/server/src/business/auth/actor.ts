import { eq } from "drizzle-orm";
import type { Database } from "../db/types.js";
import { agentProfile, member, user, organization } from "../db/schema.js";
import { resolveActor as resolveIdentity, hashApiKey, type ActorDependencies as IdentityDependencies } from "@tabdo/auth/actor";
import type { Actor as IdentityActor } from "@tabdo/auth/actor";
import { requireWorkspace } from "../tenant/workspace.js";
export type Actor = IdentityActor & { workspaceId?: string };
import { memberAvatarUrl } from "./avatar.js";
export type { ActorSession } from "@tabdo/auth/actor";
export { hashApiKey } from "@tabdo/auth/actor";
export type ActorDependencies = Omit<IdentityDependencies, "database" | "resolveBearer"> & Readonly<{ database: Database }>;

/** Legacy agent keys are a Tabdo credential extension; ordinary identity stays in auth. */
export async function resolveActor(req: Request, deps: ActorDependencies): Promise<Actor | null> {
  // Table API keys are capabilities; they cannot inherit the creator's workspace identity.
  if (req.headers.has("X-Tabdo-Key") || req.headers.get("authorization")?.toLowerCase().startsWith("bearer tab_")) return Promise.resolve(null);
  const actor = await resolveIdentity(req, { ...deps, async resolveBearer(raw) {
    if (!raw.toLowerCase().startsWith("agt_")) return undefined;
    const hash = await hashApiKey(raw);
    const [profile] = await deps.database
      .select()
      .from(agentProfile)
      .where(eq(agentProfile.apiKeyHash, hash))
      .limit(1);
    if (!profile) return null;

    const [mem] = await deps.database
      .select()
      .from(member)
      .where(eq(member.id, profile.memberId))
      .limit(1);
    if (!mem) return null;
    if (
      mem.organizationId !== profile.organizationId ||
      mem.userId !== profile.userId
    ) {
      return null;
    }

    const [u] = await deps.database.select().from(user).where(eq(user.id, profile.userId)).limit(1);
    if (!u) return null;
    return {
      kind: "agent",
      userId: profile.userId,
      memberId: profile.memberId,
      organizationId: profile.organizationId,
      role: mem.role,
      name: profile.displayName,
      email: u.email,
    };
  } });
  if (!actor?.organizationId) return actor;
  const url = new URL(req.url);
  const workspaceId = req.headers.get("X-Workspace-Id") ?? (/^\/api\/files\/[^/]+\/download$/.test(url.pathname) ? url.searchParams.get("workspace") : null) ?? undefined;
  const workspace = await requireWorkspace({ database: deps.database, workspaceId }, actor.organizationId);
  return { ...actor, workspaceId: workspace.id };
}

export type OrgMemberSummary = {
  id: string;
  userId: string;
  name: string;
  email: string;
  kind: "human" | "agent";
  role: string;
  image: string | null;
  createdAt: Date;
  agent: Pick<typeof agentProfile.$inferSelect, "displayName" | "persona"> | null;
};

export async function listOrgMembers(organizationId: string, deps: Readonly<{ database: Database }>): Promise<OrgMemberSummary[]> {
  const rows = await deps.database
    .select({
      memberId: member.id,
      role: member.role,
      createdAt: member.createdAt,
      userId: user.id,
      name: user.name,
      email: user.email,
      kind: user.kind,
      image: user.image,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));

  const agents = await deps.database
    .select()
    .from(agentProfile)
    .where(eq(agentProfile.organizationId, organizationId));
  const byUser = Object.fromEntries(agents.map((a) => [a.userId, a]));

  return Promise.all(rows.map(async (r) => ({
    id: r.memberId,
    userId: r.userId,
    name: r.name,
    email: r.email,
    kind: (r.kind === "agent" ? "agent" : "human") as "human" | "agent",
    role: r.role,
    image: await memberAvatarUrl(r.memberId, r.image),
    createdAt: r.createdAt,
    agent:
      r.kind === "agent" && byUser[r.userId]
        ? {
            displayName: byUser[r.userId].displayName,
            persona: byUser[r.userId].persona,
          }
        : null,
  })));
}

export { organization };
