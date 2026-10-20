export const connectionClients = ["claude-code", "claude-remote", "codex", "cursor", "grok-bot"] as const;
export type ConnectionClient = typeof connectionClients[number];
export const apiKeyPlaceholder = "tab_replace_with_your_key";
export const connectionSources: Record<ConnectionClient, string> = {
  "claude-code": "https://code.claude.com/docs/en/mcp",
  "claude-remote": "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  codex: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
  cursor: "https://cursor.com/docs/mcp",
  "grok-bot": "https://docs.x.ai/grok/connectors",
};

export function connectionClient(value: string | null): ConnectionClient {
  return connectionClients.find(client => client === value) ?? "claude-code";
}

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

// All examples deliberately use a placeholder. Credentials never enter app state,
// URLs, browser storage, or the public documentation component.
export function connectionRecipe(client: ConnectionClient, origin: string) {
  const endpoint = `${new URL(origin).origin}/mcp`;
  const authorization = `Bearer ${apiKeyPlaceholder}`;
  switch (client) {
    case "claude-code": return { code: `claude mcp add --transport http tabdo ${shellQuote(endpoint)} \\\n  --header ${shellQuote(`Authorization: ${authorization}`)}`, fields: [] };
    case "codex": return { code: `export TABDO_MCP_KEY=${shellQuote(apiKeyPlaceholder)}\ncodex mcp add tabdo --url ${shellQuote(endpoint)} \\\n  --bearer-token-env-var TABDO_MCP_KEY`, fields: [] };
    case "cursor": return { code: JSON.stringify({ mcpServers: { tabdo: { url: endpoint, headers: { Authorization: authorization } } } }, null, 2), fields: [] };
    default: return { code: null, fields: [
      { label: "serverName", value: "tabdo" },
      { label: "transport", value: "Streamable HTTP" },
      { label: "endpoint", value: endpoint },
      { label: "headerName", value: "Authorization" },
      { label: "headerValue", value: authorization },
    ] };
  }
}
