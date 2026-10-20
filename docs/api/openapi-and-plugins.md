# OpenAPI and Connect Agents

Fetch the public OpenAPI 3.1 document at `GET /api/openapi.json`, for example:

```sh
curl https://YOUR_TABDO_ORIGIN/api/openapi.json
```

It describes the public table API, including row CRUD, optional record bodies and attachments, with site configuration and publication unavailable to API keys. GraphQL is available separately at `POST /api/graphql`; see [the data API guide](site-api.md) for the shared record and view model and the matching operations.

## Connect an external agent through MCP

1. In tabdo, open **Settings → Connect agents** and choose the client you want to connect.
2. Select **Create configuration**, name the key and choose the resources and operations the client needs.
3. Copy the full configuration generated on the same page and follow the client’s setup instructions. The new key is cleared when you leave the page. If you already saved a key, fill it into the template instead.
4. Keep credentials in the client’s secure credential field. Do not put them in a chat message, URL, public website, or source control.

Connection examples use placeholders such as `<workspace MCP URL>` and `<your API key>`; replace them with the values displayed in your workspace. MCP uses the workspace MCP endpoint and does not import the OpenAPI document. The OpenAPI document is for clients that call the REST API directly.

## Authentication and access

Data API calls use a restricted `tab_` key via `Authorization: Bearer <your API key>` or the supported `X-Tabdo-Key` header. Permissions are enforced per table and operation. Key management requires a signed-in owner/admin session.

Record body reads use table Read; creating a row with a body uses Create; updating an existing body or uploading a body attachment uses Update. Downloading an attachment requires Read. API keys cannot read site configuration, create or change site views, or publish, unpublish or withdraw content, even with Read and Update grants. Site views are omitted from `listViews`; report operations are also unavailable. Manage sites in the signed-in app. See [API key management](../user-api-keys.md) and [the data API guide](site-api.md).
