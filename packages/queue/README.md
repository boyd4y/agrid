# @tabdo/queue

Queue contracts and BullMQ implementation for the Node API and worker.

- `@tabdo/queue`: message/delivery/failure contracts, validation, permanent failure
  and delayed retry requests.
- `@tabdo/queue/bullmq`: publishers and consumers; worker startup, concurrency,
  lock/stall recovery, retries, failure notifications and graceful drain/cleanup.
- `@tabdo/queue/redis`: URL/TLS/credentials and producer/worker connection policies;
  caller-owned Redis connections with error observation.
- `@tabdo/queue/lease`: resource leases, renewal, ownership checks and bounded
  concurrency groups, using caller-supplied keys.

Pass Redis configuration, queue/job names, limits and handlers explicitly. The
consumer translates `QueueDeferredError` into delayed delivery without consuming
a failure attempt, and `QueuePermanentError` into a terminal failure. Transient
errors follow BullMQ retry/backoff policy. `close()` drains active work and failure
notifications before closing owned connections; signal handling stays in the app.

Authorization, business idempotency receipts, outbox SQL transactions, automation
matching and execution belong to server. The package has no product message,
table, tenant or database dependencies. Redis/BullMQ delivery remains at least
once; the application must commit effects idempotently.

Run `pnpm --filter @tabdo/queue test`. Set
`QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381` for the isolated Redis test;
it uses random `agrid-queue-test` prefixes and never a production queue. Contracts
exercise unrelated report/cache/mail payloads, duplicate publication, deferral,
retry, permanent failure and draining. Product crash/replay/outbox tests stay in
`apps/server/test/queue` with an isolated `_queue_test` database.
