import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  kind?: string;
};

export function useAuth() {
  const { data, isPending, error, refetch } = authClient.useSession();
  const user = (data?.user as SessionUser | undefined) ?? null;
  const session = data?.session ?? null;

  const ensureOrganization = useCallback(async () => {
    if (!user) return null;
    try {
      const orgs = await authClient.organization.list();
      const list = (orgs.data ?? []) as { id: string; name: string; slug: string }[];
      if (list.length > 0) {
        await authClient.organization.setActive({ organizationId: list[0].id });
        return list[0];
      }
      const slug = `ws-${user.id.slice(0, 8)}`;
      const created = await authClient.organization.create({
        name: `${user.name || "我"}的工作区`,
        slug,
      });
      if (created.data?.id) {
        await authClient.organization.setActive({ organizationId: created.data.id });
        return created.data;
      }
    } catch (e) {
      console.warn("ensureOrganization", e);
    }
    return null;
  }, [user]);

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
