# Table API and JavaScript SDK

Manage all keys in **Settings → API Key**. Each table has four independent permissions: **Read, Create, Update, Delete**. Unchecked operations are denied; permissions cover every record in that table. New tables are not added automatically.

## Setup

Run `pnpm build:foundation`, `pnpm db:migrate`, and `pnpm dev`. A workspace owner or admin can create a key, name it, and tick the operations needed for each table. Copy the key before closing the dialog; it is only shown once. Edit grants or physically delete a key to change access immediately.

All new keys use the `tab_` prefix and work with GraphQL, table REST endpoints, and the SDK. There is one credential model. Treat a key embedded in a website as visible to every visitor: only grant operations and tables you intend that website to expose. Keys authorize record operations, not workspace administration, agent execution, schema changes, or key management. Management continues to use the user's login session.

Migration `0030_unified_api_keys` consolidates previous credentials without changing their values. Existing API keys receive CRUD grants for their workspace's current tables. Previous website keys retain exactly their original per-table read/create grants. Existing attachment links and the `X-Tabdo-Key` header remain compatible.

## SDK

```sh
pnpm --filter @tabdo/sdk build
pnpm --dir packages/sdk pack --pack-destination /tmp
# Install /tmp/tabdo-sdk-0.1.0.tgz in another project.
```

For plain HTML, copy `packages/sdk/dist/tabdo.js` beside the page and import it as an ES module. The distribution has no React, Node, or internal Tabdo runtime dependencies. npm/CDN publication is separate from deploying the application.

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

`POST /api/commands` supports `listTables`, `getTable`, `queryRows`, `getRow`, `addRow`, `updateCell`, `updateCells`, and `deleteRow` through the same services. Clients cannot supply internal organization/actor/automation options. Other commands require the authenticated workspace interface.

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
