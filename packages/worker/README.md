# @tabdo/worker

Background task execution built on `@tabdo/queue`. This package does not import
BullMQ/ioredis, product protocols, database schemas or Harness SDKs.

- Root: `createTaskWorker` consumes a real queue and dispatches its injected handler.
  `TaskPermanentError` stops retries; `TaskDeferredError` delays without spending a
  failure attempt. Transient errors retry until the delivery limit is reached.
- `/leases`: resource acquisition, busy-resource deferral, ownership and release.
  A task's `context.acquireLease()` holds the lease until the entire handler,
  including its failure bookkeeping, has finished. Worker always releases it.
- `/outbox`: bounded concurrent publication, ownership renewal, durable ACK/failure
  callbacks and exponential backoff. Applications supply claim/renew/markPublished/
  markFailed storage operations and stable message IDs; no SQL lives here.
- `/recovery`: checks missing deliveries, acquires resource leases and invokes a
  fenced recovery callback. The application decides which candidates are safe.
- `/runtime`: non-overlapping scan loops, isolated task errors, interruptible idle
  and ordered cleanup. Closing drains scans/consumer before closing other resources.
- `/node`: SIGTERM/SIGINT, startup-failure cleanup and shutdown deadlines. All
  configuration and services are supplied; no environment variables are read here.

`createTaskWorker` owns the injected queue/lease provider and closes them after its
consumer drains. Use separate transport/provider instances for independently owned
services. `startWorkerService` owns its worker and injected closeable resources;
`close()` is repeatable. In `apps/server`, only business handlers, storage operations,
configuration and thin CLI entrypoints remain.

Run `pnpm --filter @tabdo/worker test` and `pnpm --filter @tabdo/worker typecheck:test`.
Set `QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381` to exercise real report/mail
queue tasks, retries, leases and recovery. Fixtures use unique `agrid-queue-test`
prefixes. Node host tests spawn disposable processes; product PostgreSQL receipts
and crash recovery are tested separately under `apps/server/test/queue`.
