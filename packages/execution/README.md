# Execution capability

`@tabdo/execution` launches a **complete trusted control process**. It does not
implement an agent loop, a file sandbox, authentication, or a product Run repository.
The default entry contains only portable JSON contracts and validation.

`adapters/node-process` receives an explicit executable, arguments, cwd and environment.
It sends `{id, reference}` over Node IPC, waits for the child to acknowledge boot,
returns the computing handle, and supports graceful termination with a bounded hard
stop. `adapters/node-worker` receives one reference and runs the trusted callback.
A controller disconnect does not cancel the work.

Boot acknowledgement **is not durable application acceptance**. The caller must
persist work before launch, fence invocation in its authoritative store, and treat
an uncertain launch as unknown. The adapter's handle registry is local to one
controller; absence from `lookup` is not proof that work never ran. Restarted
controllers must consult their durable application receipts before launching again.
`adapters/http` and `transport/http-host` use small signed Web-standard control
requests. `internal-auth` binds method, path, body digest, audience and a bounded
timestamp through Web Crypto HMAC verification. Authentication alone does not
prevent replay: the injected host acceptance callback must atomically consult its
durable receipt. Changed or uncertain starts cannot be launched again.

HTTP completion polling starts lazily when requested. Closing that observer does
not terminate remote work; explicit termination is a separate operation. Remote
lookup returning unknown is not a retry signal. Output streams are intentionally
outside this control protocol.

No credentials or privileged closures should be put in references. Provider
configuration belongs to the trusted deployment composition. Untrusted scripts
execute in a separate Sandbox with scoped access.

Run `pnpm --filter @tabdo/execution test` for actual child-process startup,
completion, cancellation, early exits, actual HTTP control and signature tampering coverage. Cloudflare Containers/E2B and
remote lookup adapters remain to be implemented against their real lifecycles.
