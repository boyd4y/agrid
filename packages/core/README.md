# @tabdo/core

Deployment-independent contracts. This package has no runtime dependencies, Node imports, environment lookup, or mutable application registry. It currently defines automation delivery validation/identity, queue publication and streamed object storage.

Platform services receive providers explicitly. A successful `QueuePublisher.publish()` only means the provider accepted the message. Business deduplication, authorization, replay generations and execution receipts remain in PostgreSQL. The envelope carries no authenticated principal.

```ts
import type { AutomationDelivery, QueuePublisher } from "@tabdo/core";
function createRelay(publisher: QueuePublisher<AutomationDelivery>) {
  // Claim a persisted outbox record, publish, then acknowledge its claim token.
}
```

Build and verify: `pnpm --filter @tabdo/core build`, `pnpm --filter @tabdo/core test`.

Future platform, service transport and coordinator boundaries are described in [the architecture document](../../docs/architecture/dual-deployment.md). Their implementation is tracked separately; this package does not yet implement an agent execution framework.
