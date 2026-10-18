import { useCallback } from "react";
import { authClient } from "@/lib/auth-client";
import { createOrganizationInitializer } from "@/lib/ensure-organization";
import i18n from "@/i18n";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  kind?: string;
};

const initializeOrganization = createOrganizationInitializer(authClient);

export function useAuth() {
  const { data, isPending, error, refetch } = authClient.useSession();
  const user = (data?.user as SessionUser | undefined) ?? null;
  const session = data?.session ?? null;
  const userId = user?.id;
  const userName = user?.name;
  const activeOrganizationId = session?.activeOrganizationId;

  const ensureOrganization = useCallback(async () => {
    try {
      return await initializeOrganization(userId ? { id: userId, name: userName } : null, activeOrganizationId);
    } catch (e) {
      console.warn("ensureOrganization", e);
      return null;
    }
  }, [userId, userName, activeOrganizationId]);

  // Authentication updates the session asynchronously. Read its current value
  // instead of using the user/workspace captured by the submitting render.
  const ensureOrganizationForUser = useCallback(async (authenticatedUser?: SessionUser) => {
    const current = await authClient.getSession({ query: { disableCookieCache: true } });
    if (current.error || !current.data || (authenticatedUser && current.data.user.id !== authenticatedUser.id)) {
      throw new Error(current.error?.message || i18n.t("common:orgLoadFailed"));
    }
    const organization = await initializeOrganization(
      authenticatedUser ?? current.data.user,
      current.data.session.activeOrganizationId,
    );
    await refetch();
    return organization;
  }, [refetch]);

  return {
    user,
    session,
    isPending,
    error,
    refetch,
    ensureOrganization,
    ensureOrganizationForUser,
    isAuthenticated: !!user,
  };
}
