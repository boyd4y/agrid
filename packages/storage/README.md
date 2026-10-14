# @tabdo/storage

Generic streamed byte storage. The default export defines `ObjectStorage` and portable key validation; implementations are independent subpaths:

- `@tabdo/storage/adapters/local`: local filesystem, exclusive writes and traversal protection.
- `@tabdo/storage/adapters/s3`: official AWS client, compatible with private R2 over S3.
- `@tabdo/storage/adapters/r2`: native R2 binding, streamed reads with backpressure.

```ts
import type { ObjectStorage } from "@tabdo/storage";
import { createLocalStorage } from "@tabdo/storage/adapters/local";
const objects: ObjectStorage = createLocalStorage(directory);
await objects.put("reports/weekly.txt", new TextEncoder().encode("report"), "text/plain");
```

Object keys are relative paths, not Tabdo UUIDs or table fields. Platform services own upload limits, file metadata, organization/field permissions and lifecycle. `apps/server/src/storage/adapter.ts` applies Tabdo's file namespace above these generic providers.

No default barrel imports Node filesystem, AWS SDK or CF bindings. The AWS SDK is an optional peer; an application choosing S3 installs it explicitly. Adapters receive configuration/bindings directly and never read `process.env`.

`pnpm --filter @tabdo/storage build` and `test` validate generic keys, local bytes and real local R2 through Wrangler/workerd. `types:fixture` generates binding types and `build:fixture` builds the fixture without deployment. The signed S3 protocol and platform file namespace tests remain in `apps/server/test/storage/adapter.test.ts`. Read [the architecture](../../docs/architecture/dual-deployment.md) for implementation status.
