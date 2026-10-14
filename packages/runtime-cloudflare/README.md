# @tabdo/runtime-cloudflare

Cloudflare binding extensions for the same core contracts:

- `@tabdo/runtime-cloudflare/queue`: JSON publication and bounded per-message consumption. The callback must durably accept execution before resolving; it must not wait for a complete agent turn. Successful messages are acknowledged individually; failed or invalid deliveries retry. A deployment must configure retry bounds and a dead-letter queue.
- `@tabdo/runtime-cloudflare/storage`: streamed R2 reads/writes/deletion with the same object namespace as Node/S3. Platform permissions are required above this byte interface.

No Node SDK, BullMQ, AWS client or Harness is imported. Binding types come from official Workers types; actual application `Env` must be generated from its Wrangler configuration.

```ts
import { createAutomationPublisher } from "@tabdo/runtime-cloudflare/queue";
import { createR2Storage } from "@tabdo/runtime-cloudflare/storage";
// Compose inside the request handler using its bindings.
const publisher = createAutomationPublisher(env.AUTOMATION);
const objects = createR2Storage(env.OBJECTS);
```

`pnpm --filter @tabdo/runtime-cloudflare test` runs the local R2/Queues fixture in workerd through Wrangler's official `createTestHarness`. `types:fixture` regenerates its Env and `build:fixture` performs a dry-run build. The pinned local runtime supports compatibility date `2026-10-13`. Tests use fresh local storage, no real credentials and no remote resources.

`test/fixture/worker.ts` is an isolated test harness, **not a public Tabdo deployment entry point**. Better Auth, PostgreSQL/Hyperdrive, DO coordination and independent Harness execution are subsequent implementation stages. See [the target architecture](../../docs/architecture/dual-deployment.md).
