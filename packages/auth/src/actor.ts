import { eq, and, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { user, member, userApiKeys, type MemberRole } from "./schema.js";
import { sha256 } from "@tabdo/core/crypto";

export type AuthDatabase = Pick<PostgresJsDatabase, "select" | "insert" | "delete">;

export type Actor = {
  kind: "human" | "agent";
  userId: string;
  memberId: string;
  organizationId: string;
  role: MemberRole | string;
  name: string;
  email: string;
};

export type ActorSession = Readonly<{
  user: Readonly<{ id: string; name: string; email: string; kind?: string | null }>;
  session: Readonly<{ activeOrganizationId?: string | null }>;
}>;
export type ActorDependencies = Readonly<{
  database: AuthDatabase;
  resolveBearer?: (token: string) => Promise<Actor | null | undefined>;
  resolveSession: (headers: Headers) => Promise<ActorSession | null | undefined>;
  logger?: Readonly<{ warn(event: string, error: unknown): void }>;
}>;
export const hashApiKey = sha256;

/** Resolve actor from a session cookie or a user / legacy agent Bearer key. */
export async function resolveActor(req: Request, deps: ActorDependencies): Promise<Actor | null> {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer tab_")) {
    const raw = authHeader.slice("bearer ".length).trim();
    if (!/^tab_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const [hit] = await deps.database.select({ account: user, membership: member })
      .from(userApiKeys)
      .innerJoin(user, eq(user.id, userApiKeys.userId))
      .innerJoin(member, and(eq(member.userId, userApiKeys.userId), eq(member.organizationId, userApiKeys.organizationId)))
      .where(and(eq(userApiKeys.keyHash, await hashApiKey(raw)), isNull(userApiKeys.revokedAt))).limit(1);
    if (!hit || hit.account.kind !== "human") return null;
    return { kind: "human", userId: hit.account.id, memberId: hit.membership.id,
      organizationId: hit.membership.organizationId, role: hit.membership.role,
      name: hit.account.name, email: hit.account.email };
  }
  if (authHeader?.toLowerCase().startsWith("bearer ") && deps.resolveBearer) {
    const resolved = await deps.resolveBearer(authHeader.slice("bearer ".length).trim());
    if (resolved !== undefined) return resolved;
  }

  let session: ActorSession | null | undefined = null;
  try {
    session = await deps.resolveSession(req.headers);
  } catch (e) {
    try { deps.logger?.warn("getSession failed", e); } catch { /* Observation cannot change authentication. */ }
    return null;
  }
  if (!session?.user) return null;

  const orgId =
    session.session.activeOrganizationId ||
    null;

  if (!orgId) {
    // fall back: first membership
    const [mem] = await deps.database
      .select()
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1);
    if (!mem) {
      return {
        kind: session.user.kind === "agent" ? "agent" : "human",
        userId: session.user.id,
        memberId: "",
        organizationId: "",
        role: "owner",
        name: session.user.name,
        email: session.user.email,
      };
    }
    return {
      kind: session.user.kind === "agent" ? "agent" : "human",
      userId: session.user.id,
      memberId: mem.id,
      organizationId: mem.organizationId,
      role: mem.role,
      name: session.user.name,
      email: session.user.email,
    };
  }

  const [mem] = await deps.database
    .select()
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId)))
    .limit(1);

  // Active org set but no membership → deny (do not invent member access)
  if (!mem) return null;

  return {
    kind: session.user.kind === "agent" ? "agent" : "human",
    userId: session.user.id,
    memberId: mem.id,
    organizationId: orgId,
    role: mem.role,
    name: session.user.name,
    email: session.user.email,
  };
}

