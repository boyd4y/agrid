import { createHash, randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { agentProfile, member, user, organization } from "../db/schema.js";
import type { MemberRole } from "../db/schema.js";
import { auth } from "./index.js";

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

export function generateApiKey() {
  const raw = `agt_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) };
}

/** Resolve actor from Better Auth session cookie OR Agent Bearer API key */
export async function resolveActor(req: Request): Promise<Actor | null> {
  const authHeader = req.headers.get("authorization");
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

    const [u] = await db.select().from(user).where(eq(user.id, profile.userId)).limit(1);
    return {
      kind: "agent",
      userId: profile.userId,
      memberId: profile.memberId,
      organizationId: profile.organizationId,
      role: mem.role,
      name: profile.displayName,
      email: u?.email ?? "",
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

  return {
    kind: (session.user as { kind?: string }).kind === "agent" ? "agent" : "human",
    userId: session.user.id,
    memberId: mem?.id ?? "",
    organizationId: orgId,
    role: mem?.role ?? "member",
    name: session.user.name,
    email: session.user.email,
  };
}

export async function listOrgMembers(organizationId: string) {
  const rows = await db
    .select({
      memberId: member.id,
      role: member.role,
      createdAt: member.createdAt,
      userId: user.id,
      name: user.name,
      email: user.email,
      kind: user.kind,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));

  const agents = await db
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
    createdAt: r.createdAt,
    agent:
      r.kind === "agent" && byUser[r.userId]
        ? {
            displayName: byUser[r.userId].displayName,
            persona: byUser[r.userId].persona,
            apiKeyPrefix: byUser[r.userId].apiKeyPrefix,
          }
        : null,
  }));
}

export { organization };
