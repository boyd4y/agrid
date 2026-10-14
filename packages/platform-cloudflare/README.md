# @tabdo/platform-cloudflare

Workers implementations of generic framework capabilities. No Node SDK, Tabdo schema, business service or AI protocol dependency.

- `/queue`: publish typed envelopes and explicitly acknowledge/retry individual messages after the injected acceptance callback succeeds.
- `/storage/r2`: ordinary object keys and byte streams.
- `/coordination/contracts`, `/coordination/coordinator`: generic per-scope Durable Object. The application supplies reference parsing, scope identity, credentials-aware output/cancel services, event payloads and stream framing. Only rebuildable coordination metadata is stored locally.
- `/triggers`: thin Queue/Cron callbacks into injected services.
- `/execution/container-object`: dedicated DO/container per resource, durable launch marker, injected acceptance/prepare/probe, trusted fixed argv and lifecycle controls. Never imports business repositories or native SDKs.
- `/execution/container`: core `ExecutionAdapter` over typed DO RPC. Start acknowledges spawn, completion observation is lazy, closing observation does not cancel compute. Unknown execution is never replayed.
- `/internal-auth`: reexports core's portable signed control protocol.

The application owns generated Env types and Wrangler bindings; implementations receive them explicitly. Source compilation uses only Workers runtime types. Node types are confined to the local test driver. Wrangler imports TypeScript source through the `workerd` condition and does not need a prior package build.

`apps/cloudflare` injects Tabdo execution references and the existing AI UI SSE protocol. Linux Sandbox control belongs on this side; the native Harness executes within the Sandbox image, where Node libraries can be used.

Run `pnpm --filter @tabdo/platform-cloudflare test` for real local Workers Queue/R2 tests. Product PG/Auth/DO tests remain in `apps/cloudflare/test`; those and the full Sandbox dispatch are separate verification scopes.


`pnpm --filter @tabdo/platform-cloudflare test:container` explicitly runs the Docker-backed control fixture; Docker must be running. `typecheck:container` checks its generated Worker Env separately. The finite program proves spawn/exit, duplicate start, per-resource isolation, cold DO metadata, token-bound readonly probe, startup failure and cancellation races. It is framework control verification, not native SDK/PG gateway verification. Native Harness cold restore is tested separately in `apps/cloudflare/sandbox`.

The Container API process ID is opaque; in local development it need not equal the Linux PID inside the container. Persisted PID or `container.running` alone never proves which program is executing. A cold DO without an application probe returns unknown. Applications must persist cancellation before calling resource termination and retain authoritative output/checkpoints outside temporary compute. Configure inactivity bounds and appropriate wakeups for the supported run duration.
