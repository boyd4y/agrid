export const apiKeyPlaceholder = "tab_replace_with_your_key";

// Public guides discard credentials even when a caller accidentally supplies one.
export function connectionValues(origin: string, { secret, publicMode = false }: { secret?: string; publicMode?: boolean } = {}) {
  return {
    endpoint: `${new URL(origin).origin}/mcp`,
    authorization: `Bearer ${publicMode ? apiKeyPlaceholder : secret || apiKeyPlaceholder}`,
  };
}
