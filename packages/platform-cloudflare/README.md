# @tabdo/platform-cloudflare

Workers implementations of generic framework capabilities. No Node SDK, Tabdo schema, business service or AI protocol dependency.

- `/queue`: publish typed envelopes and explicitly acknowledge/retry individual messages after the injected acceptance callback succeeds.
- `/storage/r2`: ordinary object keys and byte streams.
- `/coordination/contracts`, `/coordination/coordinator`: generic per-scope Durable Object. The application supplies reference parsing, scope identity, credentials-aware output/cancel services, event payloads and stream framing. Only rebuildable coordination metadata is stored locally.
- `/triggers`: thin Queue/Cron callbacks into injected services.
- `/internal-auth`: reexports core's portable signed control protocol.

The application owns generated Env types and Wrangler bindings; implementations receive them explicitly. Source compilation uses only Workers runtime types. Node types are confined to the local test driver. Wrangler imports TypeScript source through the `workerd` condition and does not need a prior package build.

`apps/cloudflare` injects Tabdo execution references and the existing AI UI SSE protocol. Linux Sandbox control belongs on this side; the native Harness executes within the Sandbox image, where Node libraries can be used.

Run `pnpm --filter @tabdo/platform-cloudflare test` for real local Workers Queue/R2 tests. Product PG/Auth/DO tests remain in `apps/cloudflare/test`; those and the full Sandbox dispatch are separate verification scopes.
