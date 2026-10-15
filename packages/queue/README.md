# @tabdo/queue

Queue contracts and BullMQ implementation for the Node API and worker.

- `@tabdo/queue`: message envelope, publisher contract and validation.
- `@tabdo/queue/bullmq`: BullMQ queues, publishers and connection cleanup.

Pass Redis configuration, queue/job names and payloads explicitly. Authorization,
outbox transactions, retry policy and automation behavior belong to the caller.

Run `pnpm --filter @tabdo/queue test`. Set
`QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381` for the isolated Redis test;
it uses a random `agrid-queue-test` prefix and never a production queue.
