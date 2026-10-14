# @tabdo/runtime-node

Explicit Node extensions for the common contracts:

- `@tabdo/runtime-node/queue`: BullMQ producer, stable application job IDs and owned Redis connection cleanup. Connection settings are supplied by the composition entry point.
- `@tabdo/runtime-node/storage`: local filesystem and S3-compatible streamed object storage, including private R2 over S3.

Subpath exports prevent importing storage from implicitly starting Redis. Neither extension reads `process.env`. `apps/server` currently composes them; its existing database, permissions and upload limits stay in the platform layer.

Build and verify: `pnpm --filter @tabdo/runtime-node build`, `pnpm --filter @tabdo/runtime-node test`. Real BullMQ crash, Redis outage and S3-signature regressions remain in `apps/server/test/`; follow [the isolated testing instructions](../../docs/testing.md).

The package currently contains infrastructure providers, not a complete Node coordinator or independent Harness runner. See [implementation status](../../docs/architecture/dual-deployment.md#实施记录).
