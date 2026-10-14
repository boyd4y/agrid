# Cloudflare composition primitives

This entry package supplies a per-thread Durable Object factory and Queue/Cron handler factory. Its root export contains contracts only; importing it does not load `cloudflare:workers`, Node harness SDKs, database connections or global credentials.

`createSessionCoordinator(services)` takes authenticated, durable platform callbacks. `readOutput` returns persisted AI SDK UI message chunks with monotonically increasing ordinals. `cancel` must commit cancellation with current permission/fence checks before returning. Credentials are forwarded, never converted into a cached principal by the DO. One DO is routed as `thread:<threadId>`; its SQLite storage holds only routing metadata. Output and Run/Session status remain in PostgreSQL.

The SSE projection preserves the AI SDK UI stream headers and chunk data, adds cursor `id` fields, paginates with backpressure and rechecks access on every read. Explicit `Last-Event-ID` or `after` reconnect skips prior chunks. Closing a subscription does not stop execution. Long-lived SSE subscriptions keep the DO active and incur duration charges; this is not the WebSocket hibernation path.

`createCloudflareTriggers(services)` acknowledges Queue messages only after the shared platform acceptance callback commits durable work. The callback must not await a complete Harness turn. Schedule callbacks wake the common due-schedule service with the Cron trigger time; they do not create another scheduling implementation.

`./internal-auth` reexports the execution capability’s portable authentication helpers. They sign bounded control requests with HMAC-SHA256 using Web Crypto. The MAC binds audience, HTTP method, exact path/query, timestamp, request ID and body hash. Verification uses `crypto.subtle.verify`; it does not trust body IDs as principals. Atomically claim the request ID together with durable acceptance in PostgreSQL: a timestamp window alone does not prevent replay. The Node→workerd fixture proves signature interoperability, tampering rejection and one durable receipt for a repeated signed request.

## Local proof

Use an isolated database ending in `_agent_test`:

```sh
DATABASE_URL=postgresql://tableapp:tableapp@127.0.0.1:5432/tabdo_agent_test pnpm --filter @tabdo/cloudflare test
pnpm --filter @tabdo/cloudflare typecheck:test
pnpm --filter @tabdo/cloudflare build:fixture
```

The generic workerd fixture injects a small PostgreSQL-backed test service. It verifies DO abort/reconstruction, multi-page output, cursor replay, credentials and access revocation, disconnect/cancel separation, Queue retries/durable receipt deduplication and schedule wakeups.

A separate `platform-worker.ts` fixture imports `@tabdo/backend/services/sessions` and the shared Hono command route directly with per-callback owned PG/Auth resources. It uses real Better Auth cookies and user API keys, real private execution/output tables and the common membership-protected cancellation function. It verifies same-workspace private-owner denial, the full execution/run/thread reference, live member revocation and actual persisted cancellation. It also verifies HTTP batch row writes, whole-batch uniqueness rollback, actor-controlled workspace scope, member lookup, command allowlisting and revoked-key rejection. Its graph includes no server application source, ALS, native Harness SDKs, JustBash or Node startup/env loading. These fixtures verify shared services; they do not constitute the complete product Worker entry.

## Remaining product seams

Read/cancel services are now composed with the actual scoped platform repositories and Better Auth. Still compose durable acceptance/dispatch and Queue/Cron with the common schedule/outbox services. The full product Worker entry, the complete runner launch composition and execution-token issuance, hibernating bridge, remote Hyperdrive settings and remote deploy acceptance remain to be completed. This package alone does not make Tabdo edge-ready.
