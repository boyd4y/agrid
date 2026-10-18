# OpenAPI and Grok Bot

Fetch the public OpenAPI 3.1 document at `GET /api/openapi.json`, for example:

```sh
curl https://YOUR_TABDO_ORIGIN/api/openapi.json
```

The maintained source is `apps/server/src/business/http/openapi.ts`. It uses full `/api/...` paths with server URL `/` (the deployment origin). It covers table listing and metadata, row pagination and filtered queries, row create/read/update/delete, and the table record commands at `POST /api/commands`. Request and response schemas describe column-ID cell maps, cursors, limits (default 50, maximum 100), mutation receipts, and `{ error: string }` errors. Keep this source aligned when changing the routes.

GraphQL is available separately at `POST /api/graphql`; its full schema and calendar, document, and blog operations are outside this document. See [the data API guide](site-api.md).

## Enable Grok Bot

1. As a workspace owner or admin, open **Settings → API Key → Enable Grok Bot**.
2. Select at least one table in the picker and confirm the listed table names. Selection starts empty. The action creates a `Grok Bot` key with **Read only** on the selected tables. Future tables are not granted automatically; edit the key later to expand access.
3. Save the secret displayed once. The dialog includes copy controls for the secret, OpenAPI URL, and plugin manifest URL.
4. Import the OpenAPI URL into your Grok Bot connector and paste the secret into its Bearer authentication field. When configuring a header manually, send `Authorization: Bearer tab_...`.

If an active key named exactly `Grok Bot` exists, the action shows its metadata and connection instructions without creating another key. Its secret cannot be retrieved. Use your saved secret, or revoke the old key and enable again. Review existing grants in the key editor; the enable action does not reset them. Add Create/Update there only if writes are needed, and avoid Delete unless required.

The public manifest at `GET /api/plugins/grok-bot` describes authentication, recommended permissions, and installation steps. Its OpenAPI URL uses the configured public origin (`BETTER_AUTH_URL`, then `APP_URL`), falling back to the request origin. `/docs` is its stable documentation entry. No connector is installed remotely by this action; finish configuration in Grok Bot.

## Authentication and security

The specification and manifest require no authentication. Data calls require a restricted `tab_` key via `Authorization: Bearer tab_...` or the alternative `X-Tabdo-Key` header. Permissions remain enforced per table and operation. Key management requires a signed-in owner/admin session.

Prefer Read-only bot keys and review the tables granted before sharing the secret. Treat keys embedded in websites as public to every visitor. Keep secrets out of source control, public URLs, and logs; store them in the connector's credential field. Revoke compromised or unused keys in Settings. See [API key management](../user-api-keys.md).
