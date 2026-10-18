import type { ApiKeyInfo, ApiKeyInput } from "@tabdo/shared";

type KeyApi = {
  listApiKeys: () => Promise<{ keys: ApiKeyInfo[]; tables: { id: string }[] }>;
  createApiKey: (input: ApiKeyInput) => Promise<{ key: ApiKeyInfo; secret: string }>;
};

/** Refresh active keys before enabling; secrets are only available on creation. */
export async function enableGrokBot(api: KeyApi, tableIds: readonly string[]) {
  const current = await api.listApiKeys();
  const existing = current.keys.find(key => key.name === "Grok Bot");
  if (existing) return { key: existing };
  const selected = current.tables.filter(table => tableIds.includes(table.id));
  if (!selected.length) return null;
  return api.createApiKey({
    name: "Grok Bot",
    permissions: selected.map(table => ({ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false })),
  });
}
