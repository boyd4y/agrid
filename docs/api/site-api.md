# Site data API and JavaScript SDK

Use Tabdo as the data source for a small website, catalog, landing page, or lead form. The public surface supports table metadata, record reads, attachments, and record creation. The existing workspace REST API remains unchanged.

## Start locally

1. Run `pnpm install`, `pnpm build:foundation`, and `pnpm db:migrate` against the local development database.
2. Start the product with `pnpm dev`.
3. Open **Settings → Site API** as a workspace owner or admin. Create a key, select the allowed tables, and choose **Read only**, **Create only**, or **Read and create**.
4. Copy the key and code before closing the dialog. Keys can be edited or deleted; deleted keys immediately lose data and attachment access.

A site key starts with `tab_pub_` and is intended to appear in browser code. It grants the chosen capabilities to **all records and fields in the selected tables**. It does not identify an individual visitor. Do not select a table containing information that should remain internal. Future tables are not automatically included. There is no additional per-table publishing setup or row-policy language.

Personal `tab_` API keys retain their existing user permissions and are not accepted by this public surface. Do not put a personal key in a site. A public key is not accepted by management REST, commands, chat, or key-management endpoints.

## SDK

The workspace package is `@tabdo/sdk`. No npm or CDN publication is required for local use:

```sh
pnpm --filter @tabdo/sdk build
pnpm --dir packages/sdk pack --pack-destination /tmp
# In another project, install the generated /tmp/tabdo-sdk-0.1.0.tgz.
```

The package contains standalone ESM JavaScript and bundled TypeScript declarations. For plain HTML, copy `packages/sdk/dist/tabdo.js` beside your page and import `./tabdo.js` in a module script. It has no React, Node, or internal Tabdo runtime dependencies.

```ts
import { createClient, TabdoApiError } from '@tabdo/sdk';

const tabdo = createClient({
  url: 'https://YOUR_TABDO_API_ORIGIN',
  key: 'YOUR_PUBLISHABLE_SITE_KEY',
});

const tables = await tabdo.tables();
const table = tabdo.table('TABLE_UUID');
const columns = await table.columns();
const page = await table.list({
  limit: 20,
  filters: [{ columnId: 'COLUMN_UUID', op: 'contains', value: 'launch' }],
  sort: { columnId: 'COLUMN_UUID', direction: 'asc' },
});
const next = page.hasMore ? await table.list({ limit: 20, cursor: page.nextCursor }) : null;
const row = await table.get('ROW_UUID'); // null when the record does not exist
const submission = await table.create({ COLUMN_UUID: 'Hello from the website' });
```

Keep the same filters and sort when continuing a cursor. Identifiers are stable UUIDs; names are display metadata, not API identifiers. `list()` defaults to 50 records and allows 1–100. `includeTotal: true` explicitly requests a matching count. Filters support `eq`, `neq`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, `gt`, `gte`, `lt`, and `lte`, subject to the column type. `filterLogic` accepts `and` or `or`.

Each SDK method accepts a final `{ signal }` option. `createClient` also accepts an injected `fetch`. Failures throw `TabdoApiError` with `code`, HTTP `status`, and GraphQL `errors`; cancellations preserve `AbortError`. There are no automatic mutation retries, browser cookies, toasts, or framework state.

## GraphQL

The endpoint is `/api/graphql`. Send a publishable key in `X-Tabdo-Key` and JSON `{ query, variables, operationName? }`. Standard GraphQL clients and authenticated introspection are supported. GET supports queries; mutations require POST. HTTP batching and subscriptions are not provided.

```graphql
query Catalog($tableId: ID!, $options: RowsInput) {
  table(id: $tableId) {
    id
    name
    columns { id name type readable writable options { id label color } }
    rows(options: $options) {
      rows { id cells files { id columnId name mimeType size url } }
      nextCursor
      hasMore
      totalMatched
    }
  }
}

mutation Submit($tableId: ID!, $cells: JSON!) {
  createRow(tableId: $tableId, cells: $cells) { id createdAt }
}
```

Use `tabdo.graphql<Result>(query, variables, { operationName, signal })` for raw GraphQL. The schema is fixed across workspaces: dynamic values use the JSON `cells` map. It does not generate GraphQL object types for each user table.

A create-only key can read table/column metadata to build a form, but cannot query records or attachments. Creation returns only the new ID and timestamp. Writable types are text, number, date, checkbox, select, and multi-select. Select values use option IDs. Formula/rollup, person, relation, and file writes are rejected. This prevents a public “create” from modifying inverse relations, assigning members, or referencing arbitrary uploads.

Related records and member details are never automatically expanded. Relation and rollup values whose source table is not authorized are null and cannot be used for sorting or filtering. Formula values are conservatively null when a linked source in that table is private. Column metadata omits formula expressions and relation configuration.

## Images and attachments

Each returned row includes `files`, with metadata and a URL suitable for an `<img src>` or download link. The URL contains the publishable key, not a personal secret. Every request checks the live key, allowed table, row, column, and exact file reference; removing a reference or deleting the key removes access. Never log the full URL in application analytics.

Attachment URLs use the configured public API origin (`BETTER_AUTH_URL`, falling back to `APP_URL`), preserving HTTPS behind a TLS-terminating proxy. The underlying local/S3 bucket remains private. Safe raster image types display inline; other formats download with restrictive content headers. Uploads are managed through the existing authenticated workspace UI, not this API. Responses use `private, no-store` so cached images cannot bypass a later permission change.

## Limits and deployment

The API process uses its existing Redis connection settings (`REDIS_URL`, `QUEUE_PREFIX`) for shared rate counters; no queue job is required. Defaults are 120 public requests and 20 creates per minute, per key and trusted peer address. Reverse-proxy headers supplied by clients are ignored, so behind a proxy the shared peer may conservatively share a bucket. Missing or unavailable rate-limit storage returns 503. The endpoint allows cross-origin public requests without cookies; management CORS is unchanged.

Requests are limited to 128 KiB, 20 root fields, depth 16, and 1,000 expanded selections. A request may read at most 1,000 requested rows across at most 30 row-query resolvers. Each mutation operation can create one record; aliases and fragments cannot bypass this. Unexpected errors do not expose SQL or stack traces. Expected errors use `extensions.code`, such as `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_USER_INPUT`, `QUERY_TOO_COMPLEX`, and `RATE_LIMITED`.

Apply migration `0029_site_api` before enabling the UI. It adds workspace-owned key/grant tables without changing personal API keys or existing table data. The standard server image includes the SDK workspace manifest; the SDK build produces all distributable artifacts. Deployment remains the existing Node API + worker + PostgreSQL + Redis arrangement.

## HTML examples

```sh
pnpm --filter @tabdo/sdk build
node examples/sites/server.mjs
```

Open `http://127.0.0.1:4178/catalog.html` with a read key, or `/lead-form.html` with a create key. Configure the page through its URL fragment:

```text
#url=http%3A%2F%2Flocalhost%3A3001&key=YOUR_SITE_KEY&table=TABLE_UUID
```

The catalog demonstrates pagination, escaped text rendering, and referenced images. The form discovers writable text/number columns and submits a new record without reading historical submissions. Configure links separately when using different tables or keys. The example server serves only its explicit example assets and the built SDK, never the repository or environment files.

## Backend review decisions

- GraphQL is a transport over the existing command layer, not a second database CRUD implementation. Creation retains formula evaluation, transactional automation matching, and post-commit Outbox wakeup.
- Public capability identity remains separate from human/agent `Actor`; public submissions have no forged human `actorId`.
- Site creation revalidates the live key in the write transaction and holds the table lock before validating column types. Management rejects cross-workspace grants.
- Management metadata never returns key hashes or full credentials after creation. Deletion is physical, with cascading grant removal.
- Table metadata is batched. Row query work, pagination, request size, and writes are bounded independently of GraphQL aliases.
- Existing REST error conventions and endpoint consolidation are broader work; this feature leaves those contracts in place. No Postgres GraphQL extension, RLS policy engine, dynamic schema, GraphQL server package, or realtime subscription layer is introduced.
