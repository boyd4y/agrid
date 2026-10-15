# @tabdo/queue

Message transport and BullMQ/Redis mechanisms, independent of task execution policy.

- Root: messages, deliveries, completion/retry/defer dispositions, consumer controls,
  inspection and lease contracts.
- `/bullmq`: `createBullMQTransport`; publish, consume, lookup, remove and status.
  Owns BullMQ locks, stalled recovery, acknowledgement and retry operations.
- `/redis`: explicit URL/TLS/credentials and producer/consumer connection policies.
- `/lease`: Redis atomic resource leases, renewal, ownership checks and release;
  `createRedisLeaseProvider` owns its connection.

A consumer receives a disposition from its caller. It translates defer into delayed
redelivery without spending a failure attempt, and permanent retry into terminal
failure. No provider Job/Worker/Redis objects escape through the transport interface.
Redis-specific factories are used only in infrastructure assembly.

Consumer `close()` drains active delivery and failure notifications before closing
its driver. Transport `close()` resets the publisher/inspector connection; subsequent
operations reconnect. `@tabdo/worker` owns execution policy, handlers, resource
lifetimes, outbox loops and process shutdown; queue never imports worker or product
code. Delivery is at least once; applications must commit effects idempotently.

Run `pnpm --filter @tabdo/queue test`. Set
`QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381` for real Redis contracts. They
use random `agrid-queue-test` prefixes and clean only their own keys. Execution,
retry and drain integration tests live in `packages/worker/test`; product outbox,
crash and replay tests stay in `apps/server/test/queue` on an isolated `_queue_test`
database.
