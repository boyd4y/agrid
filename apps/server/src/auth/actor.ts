import { createHash } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db, type Transaction } from "../db/index.js";
import { agentProfile, member, user, organization, userApiKeys } from "../db/schema.js";
import type { MemberRole } from "../db/schema.js";
import { auth } from "./index.js";
import { memberAvatarUrl } from "./avatar.js";

export type Actor = {
  kind: "human" | "agent";
  userId: string;
  memberId: string;
  organizationId: string;
  role: MemberRole | string;
  name: string;
  email: string;
};

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

/** Resolve actor from a session cookie or a user / legacy agent Bearer key. */
export async function resolveActor(req: Request): Promise<Actor | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer tab_")) {
    const raw = authHeader.slice("bearer ".length).trim();
    if (!/^tab_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const [hit] = await db.select({ account: user, membership: member })
      .from(userApiKeys)
      .innerJoin(user, eq(user.id, userApiKeys.userId))
      .innerJoin(member, and(eq(member.userId, userApiKeys.userId), eq(member.organizationId, userApiKeys.organizationId)))
      .where(and(eq(userApiKeys.keyHash, hashApiKey(raw)), isNull(userApiKeys.revokedAt))).limit(1);
    if (!hit || hit.account.kind !== "human") return null;
    return { kind: "human", userId: hit.account.id, memberId: hit.membership.id,
      organizationId: hit.membership.organizationId, role: hit.membership.role,
      name: hit.account.name, email: hit.account.email };
  }
  if (authHeader?.toLowerCase().startsWith("bearer agt_")) {
    const raw = authHeader.slice("bearer ".length).trim();
    const hash = hashApiKey(raw);
    const [profile] = await db
      .select()
      .from(agentProfile)
      .where(eq(agentProfile.apiKeyHash, hash))
      .limit(1);
    if (!profile) return null;

    const [mem] = await db
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

    const [u] = await db.select().from(user).where(eq(user.id, profile.userId)).limit(1);
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
  }

  let session = null as Awaited<ReturnType<typeof auth.api.getSession>> | null;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch (e) {
    console.warn("getSession failed", e);
    return null;
  }
  if (!session?.user) return null;

  const orgId =
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ||
    null;

  if (!orgId) {
    // fall back: first membership
    const [mem] = await db
      .select()
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1);
    if (!mem) {
      return {
        kind: (session.user as { kind?: string }).kind === "agent" ? "agent" : "human",
        userId: session.user.id,
        memberId: "",
        organizationId: "",
        role: "owner",
        name: session.user.name,
        email: session.user.email,
      };
    }
    return {
      kind: (session.user as { kind?: string }).kind === "agent" ? "agent" : "human",
      userId: session.user.id,
      memberId: mem.id,
      organizationId: mem.organizationId,
      role: mem.role,
      name: session.user.name,
      email: session.user.email,
    };
  }

  const [mem] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId)))
    .limit(1);

  // Active org set but no membership → deny (do not invent member access)
  if (!mem) return null;

  return {
    kind: (session.user as { kind?: string }).kind === "agent" ? "agent" : "human",
    userId: session.user.id,
    memberId: mem.id,
    organizationId: orgId,
    role: mem.role,
    name: session.user.name,
    email: session.user.email,
  };
}

export async function listOrgMembers(organizationId: string, transaction?: Transaction) {
  const rows = await (transaction ?? db)
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

  const agents = await (transaction ?? db)
    .select()
    .from(agentProfile)
    .where(eq(agentProfile.organizationId, organizationId));
  const byUser = Object.fromEntries(agents.map((a) => [a.userId, a]));

  return rows.map((r) => ({
    id: r.memberId,
    userId: r.userId,
    name: r.name,
    email: r.email,
    kind: (r.kind === "agent" ? "agent" : "human") as "human" | "agent",
    role: r.role,
    image: memberAvatarUrl(r.memberId, r.image),
    createdAt: r.createdAt,
    agent:
      r.kind === "agent" && byUser[r.userId]
        ? {
            displayName: byUser[r.userId].displayName,
            persona: byUser[r.userId].persona,
          }
        : null,
  }));
}

export { organization };
