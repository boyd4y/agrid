# Table API and JavaScript SDK

See [OpenAPI and Connect Agents](openapi-and-plugins.md) for the public OpenAPI 3.1 specification and generic MCP connection guidance.

Manage all keys in **Settings → API Key**. Each table has four independent permissions: **Read, Create, Update, Delete**. Unchecked operations are denied; permissions cover every record in that table. New tables are not added automatically.

## Setup

Run `pnpm build:foundation`, `pnpm db:migrate`, and `pnpm dev`. A workspace owner or admin can create a key, name it, and tick the operations needed for each table. Copy the key before closing the dialog; it is only shown once. Edit grants or physically delete a key to change access immediately.

All new keys use the `tab_` prefix and work with GraphQL, table REST endpoints, and the SDK. There is one credential model. Treat a key embedded in a website as visible to every visitor: only grant operations and tables you intend that website to expose. Keys authorize record operations, not workspace administration, agent execution, schema changes, or key management. Management continues to use the user's login session.

Migration `0030_unified_api_keys` consolidates previous credentials without changing their values. Existing API keys receive CRUD grants for their workspace's current tables. Previous website keys retain exactly their original per-table read/create grants. Existing attachment links and the `X-Tabdo-Key` header remain compatible.

## SDK

```sh
pnpm --filter @tabdo/sdk build
pnpm --dir packages/sdk pack --pack-destination /tmp
# Install /tmp/tabdo-sdk-0.1.1.tgz in another project.
```

For applications, install the published `@tabdo/sdk` package. For plain HTML, import the standalone browser module directly from the deployment's fixed `SITE_SDK_URL`, for example `https://cdn.jsdelivr.net/npm/@tabdo/sdk@0.1.1/dist/tabdo.js` after that npm version is published. The distribution has no React, Node, or internal Tabdo runtime dependencies. npm/CDN publication is separate from deploying the application; configuring the CDN URL does not publish anything. Site files do not receive an injected SDK bundle.

```ts
import { createClient } from '@tabdo/sdk';

const tabdo = createClient({ url: 'https://YOUR_TABDO_ORIGIN', key: 'YOUR_API_KEY' });
const tables = await tabdo.tables();
const table = tabdo.table('TABLE_UUID');
const columns = await table.columns();
const page = await table.list({
  limit: 20,
  filters: [{ columnId: 'COLUMN_UUID', op: 'contains', value: 'launch' }],
  sort: { columnId: 'COLUMN_UUID', direction: 'asc' },
});
const row = await table.get('ROW_UUID');
const created = await table.create({ COLUMN_UUID: 'New submission' });
await table.update(created.id, { COLUMN_UUID: 'Updated submission' });
await table.delete(created.id);
```

Permissions are independent. For example, a key can read a catalog, create leads in another table, and have no update/delete access to either. Create/update/delete return receipts, so they do not require read permission or expose historical records. `update()` accepts `{ expectedVersion }` for optional optimistic concurrency.

`list()` defaults to 50 records, maximum 100. Reuse filters and sort when continuing with `cursor: page.nextCursor`. `includeTotal: true` requests a count. Field/table identifiers are stable UUIDs; names are display metadata. Filters support the operators appropriate to each column type. Each SDK method accepts a final `{ signal }`; injected `fetch` is supported. Errors expose `TabdoApiError.code`, `status`, and GraphQL errors. Requests omit cookies and do not retry mutations automatically.

## GraphQL

POST `/api/graphql` with `Authorization: Bearer YOUR_API_KEY` and JSON `{ query, variables, operationName? }`. Standard authenticated introspection and GET queries are supported. Mutations require POST. The fixed schema uses a JSON `cells` map for user-defined columns.

Records also have a built-in `body` field. Select `Row.body` explicitly in GraphQL; `rows` does not return full bodies by default. REST POST row accepts `body: { content }`; PATCH body writes require `body: { content, expectedVersion }`, independent of the optional row version. The first write to an empty body uses version 0. Body writes require an idempotency key and API Key receipts include versions, not body content. Reading a body requires Read; creating a row with a body requires Create; updating an existing body requires Update.

Upload a body image through `POST /api/tables/:tableId/rows/:rowId/attachments` with `{ target: "body", expectedVersion, name, mimeType, base64, idempotencyKey }`. The response returns `fileId` and `bodyVersion`; reference that `fileId` in the body's image content. Upload requires Update, and `GET /api/tables/:tableId/rows/:rowId/attachments/:fileId` requires Read.

```graphql
query Catalog($id: ID!, $options: RowsInput) {
  table(id: $id) {
    columns { id name type readable writable options { id label color } }
    rows(options: $options) {
      rows { id cells files { id columnId name mimeType size url } }
      nextCursor hasMore totalMatched
    }
  }
}
mutation Create($table: ID!, $cells: JSON!) {
  createRow(tableId: $table, cells: $cells) { id createdAt }
}
mutation Update($table: ID!, $row: ID!, $cells: JSON!, $version: Int) {
  updateRow(tableId: $table, rowId: $row, cells: $cells, expectedVersion: $version) { id updatedAt version }
}
mutation Delete($table: ID!, $row: ID!) {
  deleteRow(tableId: $table, rowId: $row) { id }
}
```

Use `tabdo.graphql<Result>(query, variables, { operationName, signal })` for raw queries. Aliases/fragments cannot multiply writes: each operation permits one mutation.

## REST and commands

Use the same Bearer key and permissions:

| Method | Endpoint | Operation |
|---|---|---|
| GET | `/api/tables`, `/api/tables/:tableId` | Authorized table/column metadata |
| GET | `/api/tables/:tableId/rows?limit=20&cursor=...` | Read records |
| POST | `/api/tables/:tableId/rows/query` | Read records with JSON filter/sort options |
| GET | `/api/tables/:tableId/rows/:rowId` | Read one record |
| POST | `/api/tables/:tableId/rows` | Create with `{ cells }` |
| PATCH | `/api/tables/:tableId/rows/:rowId` | Update with `{ cells, expectedVersion? }` |
| DELETE | `/api/tables/:tableId/rows/:rowId` | Delete one record |
| POST | `/api/tables/:tableId/rows/:rowId/attachments` | Upload a row attachment, including `target: "body"` |
| GET | `/api/tables/:tableId/rows/:rowId/attachments/:fileId` | Read an authorized row attachment |

`POST /api/commands` supports `listTables`, `getTable`, `queryRows`, `getRow`, `addRow`, `updateCell`, `updateCells`, `deleteRow`, `uploadRowAttachment`, `getRowAttachment`, `createView`, `updateView`, `getView`, `listViews`, and `deleteView` for authorized API Keys. Clients cannot supply internal organization/actor/automation options.

For body access, `GET /api/tables/:tableId/rows/:rowId?include=body&bodyFormat=json` includes `body: { content, version, schemaVersion, attachments, html? }`; `bodyFormat=html` requests safe rendered HTML. Row lists omit full body content. `POST` row accepts `body: { content }`; `PATCH` row accepts `body: { content, expectedVersion }`, with body `expectedVersion` required and checked independently from the optional row `expectedVersion`. Body writes require `idempotencyKey`. A write through an API Key returns a receipt and does not return the body. Unwritten bodies read as empty version 0; reading does not create body storage.

Sites backed by table data are ordinary views. Create one with `createView({ tableId, type: "site", name, config, idempotencyKey })` and configure `template: "blog"`, `mapping: { title, slug?, summary?, author?, date?, cover?, category?, tags? }`, `authorName`, `description`, `language`, and `articles: [{ rowId, imageIds, coverFileId? }]`. All mapped fields and selected rows must belong to the source table. `getView` returns a regular view plus `site: { id, version, revisionId, publishedRevisionId, publicUrl, pendingChanges, publishedRows }`; pass `site.publishedRevisionId` as `expectedPublishedRevisionId` when publishing, using `null` for the first publish. Update with `updateView({ viewId, name?, config?, expectedVersion, idempotencyKey, publication? })`; `publication` uses `action: "publish" | "unpublish" | "withdraw"`, and `rowId` when withdrawing one record. Saving settings or changing source rows does not publish. Site view reads, configuration, and explicit publication require both Read and Update on the table.

For the internal migration record, see [Unified record and site migration](../unified-record-site-migration.md).

## Fields and files

Metadata is available for any granted table, including create-only tables so a form can discover its inputs. Writable fields currently include text, number, date, checkbox, single-select, and multi-select; selects use option IDs. Person, relation, file, formula, and rollup values cannot be written through the data API. Relation/rollup values sourced from a table without read permission are redacted; derived formulas are conservatively redacted too. Deleting a linked row additionally requires update permission on affected linked tables.

Rows include `files` with metadata and URLs for referenced images/downloads. Each request rechecks the live key and exact table/record/column/file reference. Deleting the key or removing the file reference removes access. Upload files through the authenticated workspace UI. URLs use `BETTER_AUTH_URL` (fallback `APP_URL`) to preserve HTTPS behind a proxy. Safe raster images display inline; other formats download. File responses are not cached and use restrictive content headers. Avoid logging complete attachment URLs because they include the key.

## Limits and examples

Existing Redis settings (`REDIS_URL`, `QUEUE_PREFIX`) provide shared rate counters: 120 requests and 20 writes per minute per key/trusted peer. Unavailable Redis fails closed. Limits include 128 KiB bodies, 20 GraphQL root fields, depth 16, 1,000 expanded selections/requested rows, and 30 row resolvers. REST mutations have the same permission checks and transaction/outbox behavior. No visitor cookies or workspace identity are inherited.

Run `pnpm dev:sites` for the catalog and lead-form examples on `http://127.0.0.1:4178`. Configure a page using its URL fragment:

```text
#url=http%3A%2F%2Flocalhost%3A3001&key=YOUR_API_KEY&table=TABLE_UUID
```

The catalog demonstrates escaped text, cursor pagination, and referenced images. The form submits data without reading prior submissions. The example server only serves its explicit assets and built SDK.
