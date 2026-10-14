# @tabdo/backend

Shared Tabdo business code, separate from `core` contracts and the Node/Cloudflare implementation packages. This package owns the PostgreSQL schema, explicit database/auth factories, table commands, automation configuration/events/schedules/outbox, and private Run/Session repositories.

- `@tabdo/backend/database`: `createDatabase({ connectionString, poolMax, prepare? })` returns Drizzle, its Postgres.js client and an owned `close()` method. No environment lookup or global pool.
- `@tabdo/backend/auth`: `createPlatformAuth({ database, appUrl, baseURL, secret, production, hooks?, sendInviteEmail })`. Both runtimes use the same native Better Auth/organization configuration; no replacement identity implementation.
- `@tabdo/backend/schema`: the single product schema and related types. SQL migrations stay in `apps/server/drizzle` during this incremental extraction.
- `@tabdo/backend/checkpoints`: private persisted workspace shape and validation contract. Actual filesystem snapshot/restoration and byte/path checks stay with the runtime.
- `@tabdo/backend/auth/actor`: `resolveActor(request, {database, resolveSession, logger})` and `listOrgMembers(organizationId, {database})`. Explicit dependencies, Web Crypto, live membership/key checks and no ALS or Hono dependency. Node compatibility façades preserve existing public call signatures.
- `@tabdo/backend/commands`: table/row/column/relation/view commands receive `CommandDependencies` first and an optional caller transaction. Clock, UUID and outbox queue name are injected; receipts/events and writes share the caller transaction.
- `@tabdo/backend/agent/*`: leases, durable execution acceptance/output, Run history, checkpoints and question answers. Native schema validators are injected; this package does not import native Harness SDKs.
- `@tabdo/backend/services/sessions`: private output/cancellation callbacks with fresh resources and authentication on each call.
- `@tabdo/backend/http/commands`: shared thin Hono route, including the public command allowlist and live membership check in the write transaction.
- `@tabdo/backend/errors`: transport-independent `ServiceError`; only HTTP entries map status to responses.
- Default entry: type exports only, without loading a database or auth runtime.

Node composition supplies its pool, environment settings, invitation hook and email transport. A Worker creates request-owned resources from its Hyperdrive binding and closes them after awaited database/auth work. Do not close a resource while an accepted detached Run still uses it. Long Harness execution belongs in the runner, not a short-lived Worker request.

```ts
import { createDatabase } from "@tabdo/backend/database";
const resource = createDatabase({ connectionString, poolMax: 1, prepare: true });
try { await useDatabase(resource.db); }
finally { await resource.close(); }
```

The actual integration checks remain with the application consumers: Node `test/routes/platform-factories.test.ts` and workerd `test/cloudflare/factories.test.ts`. They test real PostgreSQL, native Better Auth registration/sessions, independent signing settings and connection cleanup. Build dependencies with `pnpm build:foundation`, then run `pnpm --filter @tabdo/server test:edge` with an isolated `DATABASE_URL` ending in `_agent_test`; no remote credentials are required.

This extraction is still partial. Reports, integrations, full HTTP assembly, automation execution and agent-runtime remain to migrate. Node compatibility scopes live only in `apps/server/src/resources/scope.ts`; backend has no Node ambient types, ALS or global resource access. The real Workers/PG command and session fixture proves batch writes, rollback, member identities, private replay and cancellation. It does not prove the full product Sandbox dispatch.
