import type { ApiKeyInfo, ApiKeyInput } from "@tabdo/shared";

type KeyApi = {
  listApiKeys: () => Promise<{ keys: ApiKeyInfo[]; tables: { id: string }[] }>;
  createApiKey: (input: ApiKeyInput) => Promise<{ key: ApiKeyInfo; secret: string }>;
};

/** Refresh active keys before enabling; secrets are only available on creation. */
export async function enableGrokBot(api: KeyApi) {
  const current = await api.listApiKeys();
  const existing = current.keys.find(key => key.name === "Grok Bot");
  if (existing) return { key: existing };
  if (!current.tables.length) return null;
  return api.createApiKey({
    name: "Grok Bot",
    permissions: current.tables.map(table => ({ tableId: table.id, canRead: true, canCreate: false, canUpdate: false, canDelete: false })),
  });
}
