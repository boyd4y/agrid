import type { authClient } from "./auth-client";
import i18n from "@/i18n";

type Organization = { id: string; name: string; slug: string };
type User = { id: string; name?: string };

/** Share in-flight initialization across hook instances and StrictMode mounts. */
export function createOrganizationInitializer(client: Pick<typeof authClient, "organization">) {
  const pending = new Map<string, Promise<Organization | null>>();

  return async (user: User | null, activeOrganizationId?: string | null) => {
    if (!user || activeOrganizationId) return null;
    const existing = pending.get(user.id);
    if (existing) return existing;

    const task = (async () => {
      const response = await client.organization.list();
      if (response.error) throw new Error(response.error.message || i18n.t("common:orgLoadFailed"));
      const organizations = response.data ?? [];
      let organization: Organization | null = organizations[0] ?? null;
      if (!organization) {
        const created = await client.organization.create({
          name: i18n.t("common:myWorkspace", { name: user.name || i18n.t("common:me") }),
          slug: `ws-${user.id.slice(0, 8)}`,
        });
        if (created.error) throw new Error(created.error.message || i18n.t("common:orgCreateFailed"));
        organization = created.data;
      }
      if (organization) {
        const result = await client.organization.setActive({ organizationId: organization.id });
        if (result.error) throw new Error(result.error.message || i18n.t("common:orgSelectFailed"));
      }
      return organization;
    })();

    pending.set(user.id, task);
    try {
      return await task;
    } finally {
      pending.delete(user.id);
    }
  };
}
