import { AsyncLocalStorage } from "node:async_hooks";
import { createAuthMiddleware } from "better-auth/api";
import type { Actor } from "./actor.js";

// This context is set only around the already-authorized platform invitation call.
// It cannot be supplied by a request header or an auth API body.
const invitationActor = new AsyncLocalStorage<Actor>();

export function withUserKeyInvitation<T>(actor: Actor, work: () => Promise<T>): Promise<T> {
  return invitationActor.run(actor, work);
}

export const userKeyInvitationContext = createAuthMiddleware(async ctx => {
  const actor = invitationActor.getStore();
  if (!actor || actor.kind !== "human" || ctx.path !== "/organization/invite-member") return;
  const account = await ctx.context.internalAdapter.findUserById(actor.userId);
  if (!account || !("kind" in account) || account.kind !== "human") return;
  const now = new Date();
  // Better Auth's official hook context supports request-only sessions. The
  // organization plugin still checks membership, permissions, limits and hooks.
  // No durable session or cookie is created and the raw key is never included.
  return { context: { context: { session: {
    user: account,
    session: { id: `user-key:${actor.memberId}`, token: "", userId: actor.userId,
      activeOrganizationId: actor.organizationId, createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000), ipAddress: null, userAgent: null },
  } } } };
});
