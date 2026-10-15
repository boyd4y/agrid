# @tabdo/core

Portable infrastructure contracts, independent of Tabdo business data and runtime SDKs.

- `/queue`: typed envelopes, publication and envelope validation.
- `/storage`: byte streams and portable relative object keys.
- `/execution`: computing-resource references, startup, lookup and termination.
- `/execution/http`, `/transport/execution-http-host`, `/internal-auth`: Web-standard signed control transport. Provider boot acknowledgment does not replace a durable business receipt.
- `/harness`, `/sandbox`: generic lifecycle/assembly contracts. Implementations specialize the official SDK's session types; no replacement model loop or filesystem API.

Production source types use `types: []`. The `development` export condition selects TypeScript source; ordinary Node imports select compiled JavaScript. No vendor, backend, shared business schema or Node runtime dependencies are installed here.

Implementations live in `@tabdo/platform-node` and receive explicit configuration. Business permissions, transactions, outbox receipts and authoritative Run state belong in `@tabdo/backend`.

Run `pnpm --filter @tabdo/core test` and `pnpm check:architecture` from the repository root.
