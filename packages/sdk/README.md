# @tabdo/sdk

A small TypeScript/JavaScript client for Tabdo's GraphQL table data API. Works in browsers and Node with native `fetch`. The distributed module and declarations are self-contained.

```ts
import { createClient } from '@tabdo/sdk';
const tabdo = createClient({ url: 'https://YOUR_API_ORIGIN', key: 'YOUR_PUBLISHABLE_SITE_KEY' });
const table = tabdo.table('TABLE_UUID');
const columns = await table.columns();
const page = await table.list({ limit: 20 });
const row = await table.get('ROW_UUID');
await table.create({ COLUMN_UUID: 'New submission' });
```

Create a key in **Settings → API Key** and independently select Read, Create, Update, and Delete for each table. Use stable table and column IDs; select values use option IDs.

Every operation supports a final `{ signal }`. Inject a custom transport through `createClient({ url, key, fetch })`. Use `tabdo.graphql<T>(query, variables, { operationName, signal })` for raw GraphQL. Failures throw `TabdoApiError`; writes are never retried automatically.

Install the published package with `npm install @tabdo/sdk`. `dist/index.js` is the package ESM entry; `dist/tabdo.js` is the standalone browser module, also declared as the package's jsDelivr/UNPKG entry. After publishing the matching npm version, plain HTML can import it directly:

```html
<script type="module">
  import { createClient } from 'https://cdn.jsdelivr.net/npm/@tabdo/sdk@0.1.1/dist/tabdo.js';
  const tabdo = createClient({ url: 'https://YOUR_TABDO_ORIGIN', key: 'YOUR_API_KEY' });
</script>
```

Each Tabdo deployment sets one fixed `SITE_SDK_URL`. Overseas defaults to the versioned jsDelivr URL above; a separate China deployment can configure its own CDN URL serving the same module. Site authors do not select providers, and the platform does not copy the SDK source into site files. npm publication is a separate, explicit release action; configuring a URL does not publish the package.

The repository guide at `docs/api/site-api.md` documents GraphQL, filtering, pagination, attachment URLs, permissions, limits, packaging, and executable HTML examples.

Use `table.update(rowId, cells, { expectedVersion? })` and `table.delete(rowId)` for updates and deletes. All operations use the same per-table permissions.
