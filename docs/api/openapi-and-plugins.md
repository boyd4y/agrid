# OpenAPI and Connect Agents

Fetch the public OpenAPI 3.1 document at `GET /api/openapi.json`, for example:

```sh
curl https://YOUR_TABDO_ORIGIN/api/openapi.json
```

It describes the public table API, including row CRUD, optional record bodies and attachments, plus site views. GraphQL is available separately at `POST /api/graphql`; see [the data API guide](site-api.md) for the shared record and view model and the matching operations.

## Connect an external agent through MCP

1. In tabdo, open **Settings → Connect agents** and choose the client you want to connect.
2. Follow the selected client’s instructions. Use the workspace MCP URL shown in the connection guide and the requested authentication method.
3. If the client requires a data access key, create a generic key under **Settings → API Key**. Grant only the table operations needed for the task; there is no separate bot enablement or automatic special key creation.
4. Keep credentials in the client’s secure credential field. Do not put them in a chat message, URL, public website, or source control.

Connection examples use placeholders such as `<workspace MCP URL>` and `<your API key>`; replace them with the values displayed in your workspace. MCP uses the workspace MCP endpoint and does not import the OpenAPI document. The OpenAPI document is for clients that call the REST API directly.

## Authentication and access

Data API calls use a restricted `tab_` key via `Authorization: Bearer <your API key>` or the supported `X-Tabdo-Key` header. Permissions are enforced per table and operation. Key management requires a signed-in owner/admin session.

Record body reads use table Read; creating a row with a body uses Create; updating an existing body or uploading a body attachment uses Update. Downloading an attachment requires Read. Reading a site view requires Read; creating or changing its configuration and explicitly publishing, unpublishing, or withdrawing content requires both Read and Update on the source table. See [API key management](../user-api-keys.md) and [the data API guide](site-api.md).
