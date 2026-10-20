# OpenAPI and Grok Bot

Fetch the public OpenAPI 3.1 document at `GET /api/openapi.json`, for example:

```sh
curl https://YOUR_TABDO_ORIGIN/api/openapi.json
```

The maintained source is `apps/server/src/business/http/openapi.ts`. It uses full `/api/...` paths with server URL `/` (the deployment origin). It covers table listing and metadata, row pagination and filtered queries, row create/read/update/delete, and the table record commands at `POST /api/commands`. Request and response schemas describe column-ID cell maps, cursors, limits (default 50, maximum 100), mutation receipts, and `{ error: string }` errors. Keep this source aligned when changing the routes. The published OpenAPI is a curated subset of the table Site API and commands and may lag the full command surface; see [site-api.md](site-api.md) for authoritative details.

GraphQL is available separately at `POST /api/graphql`; its full schema and calendar, document, and blog operations are outside this document. See [the data API guide](site-api.md).

## Connect Grok Bot through remote MCP

1. As a workspace owner or admin, open **Settings → API Key → Enable Grok Bot**.
2. Select at least one table and confirm the listed names. The selection starts empty. This creates a `Grok Bot` key with **Read only** access to those tables. New tables are not added automatically.
3. Save the API key shown once. Copy the MCP server URL and configure the HTTP header as `Authorization` with value `Bearer <your API key>`; replace the placeholder with the saved key. Do not put the key in a chat message or URL.
4. In Grok Bot, add a custom MCP server, choose **Remote HTTPS**, and enter the MCP URL. Use the Streamable HTTP transport. Set the `Authorization` header as described above, leave OAuth Client ID and Client Secret empty, and add the server.
5. If Grok Bot does not install the server automatically, find it in **Connect apps** (or Marketplace in versions that use that label) and install it. In a conversation, type `@` and select the connector to attach it to the task.

For the tabdo deployment, the MCP URL is `https://tabdo.dev/mcp`. On another deployment, use that deployment's public HTTPS origin followed by `/mcp`. Grok Bot must be able to reach the URL over the public internet. For local development, expose the MCP server through a public tunnel and use the tunnel URL ending in `/mcp`.

This API-key setup requires a Grok Bot version with a custom MCP server form that supports secure HTTP headers. If your version only offers OAuth and has no HTTP headers field, this static Bearer-key connection is unavailable in that version. Use a client that supports Bearer headers. The Grok Bot help documents Connect apps and attaching installed connectors with `@`; the custom server fields and separate install step can vary by version.

If an active key named exactly `Grok Bot` already exists, the action reuses it and shows its metadata and connection instructions without creating another key. Its secret cannot be retrieved or shown again. Use your saved key, or revoke the old key and enable Grok Bot again to create a replacement. Review existing grants in the key editor because reusing the key does not reset its permissions. Add Create/Update there only if writes are needed, and avoid Delete unless required.

The remote MCP connection uses `/mcp`; it does not import the OpenAPI document. The public OpenAPI document at `GET /api/openapi.json` remains available for clients that use the table REST API. The public JSON at `GET /api/plugins/grok-bot` is a tabdo connection guide: it includes `mcp_url`, `transport`, authentication guidance, and setup steps. It is not an official Grok registration protocol. Its `openapi_url` field is retained for compatibility and is not needed to connect Grok Bot through MCP. The guide uses the configured public origin (`BETTER_AUTH_URL`, then `APP_URL`), falling back to the request origin; `/docs` is its documentation entry.

Grok Bot connector setup is documented in [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps) and [Settings and notifications](https://docs.x.ai/grok-bot/settings-and-notifications). The custom MCP network requirements are in [Custom MCP Server Tunneling](https://docs.x.ai/grok/connectors/custom-mcp-tunneling). The custom-header field sequence above was also checked against [Grok Bot's custom MCP setup guide](https://qbash.com/docs/mcp-servers/grok-bot); field availability can depend on the Grok Bot version.

## Authentication and security

The specification and manifest require no authentication. Data calls require a restricted `tab_` key via `Authorization: Bearer tab_...` or the alternative `X-Tabdo-Key` header. Permissions remain enforced per table and operation. Key management requires a signed-in owner/admin session.

Prefer Read-only bot keys and review the tables granted before sharing the secret. Treat keys embedded in websites as public to every visitor. Keep secrets out of source control, public URLs, and logs; store them in the connector's credential field. Revoke compromised or unused keys in Settings. See [API key management](../user-api-keys.md).
