import { useCallback } from "react";
import { authClient } from "@/lib/auth-client";
import { createOrganizationInitializer } from "@/lib/ensure-organization";

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

  return {
    user,
    session,
    isPending,
    error,
    refetch,
    ensureOrganization,
    isAuthenticated: !!user,
  };
}
