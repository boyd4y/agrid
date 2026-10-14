# @tabdo/queue

Generic queue contracts and adapters. No dependency on Tabdo tables, automation, users, Run state, business schema or shared product contracts.

```ts
import type { QueuePublisher } from "@tabdo/queue";
import { createBullMQPublisher } from "@tabdo/queue/adapters/bullmq";
// Alternatively: import { createCloudflarePublisher } from "@tabdo/queue/adapters/cloudflare";
const publisher: QueuePublisher<{ recipient: string }> = createBullMQPublisher(config);
await publisher.publish({ id: "mail-send-1", body: { recipient: "person@example.com" } });
```

The caller generates stable IDs and validates the business payload. Publication only acknowledges provider acceptance. In BullMQ, ID maps to `jobId` and body to job data; IDs must respect BullMQ's naming restrictions. CF sends the complete envelope, keeping application identity separate from its provider message ID. Consumers receive an untrusted body; their callback owns decoding, authorization and business deduplication.

`consumeQueueBatch` bounds concurrency and individually ACKs successful callbacks or retries failures. Production configuration must supply retry bounds and a DLQ. Tabdo's handler must durably accept execution before returning, rather than holding the queue handler for a complete agent turn.

The default export is edge-safe. Adapters use explicit subpaths; no mixed Node/CF barrel. `bullmq` and `ioredis` are optional peers, required only by an application using the BullMQ adapter.

`pnpm --filter @tabdo/queue build` and `test` validate contracts and real local CF Queues through Wrangler/workerd. For the real BullMQ adapter test, set `QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381`; otherwise it is explicitly skipped. `types:fixture` generates bindings; `build:fixture` builds the local fixture without deployment. These fixtures are not platform production entry points.
