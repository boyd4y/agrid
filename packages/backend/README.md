# @tabdo/backend

Shared Tabdo business code, separate from `core` contracts and the Node implementation package. This package owns the PostgreSQL schema, explicit database/auth factories, table commands, automation configuration/events/schedules/outbox, and private Run/Session repositories.

- `@tabdo/backend/database`: `createDatabase({ connectionString, poolMax, prepare? })` returns Drizzle, its Postgres.js client and an owned `close()` method. No environment lookup or global pool.
- `@tabdo/backend/auth`: `createPlatformAuth({ database, appUrl, baseURL, secret, production, hooks?, sendInviteEmail })`. Applications use the same native Better Auth/organization configuration; no replacement identity implementation.
- `@tabdo/backend/schema`: the single product schema and related types. SQL migrations stay in `apps/server/drizzle` during this incremental extraction.
- `@tabdo/backend/checkpoints`: private persisted workspace shape and validation contract. Actual filesystem snapshot/restoration and byte/path checks stay with the runtime.
- `@tabdo/backend/auth/actor`: `resolveActor(request, {database, resolveSession, logger})` and `listOrgMembers(organizationId, {database})`. Explicit dependencies, Web Crypto, live membership/key checks and no ALS or Hono dependency. Node compatibility façades preserve existing public call signatures.
- `@tabdo/backend/commands`: table/row/column/relation/view commands receive `CommandDependencies` first and an optional caller transaction. Clock, UUID and outbox queue name are injected; receipts/events and writes share the caller transaction.
- `@tabdo/backend/agent/*`: leases, durable execution acceptance/output, Run history, checkpoints and question answers. Native schema validators are injected; this package does not import native Harness SDKs.
- `@tabdo/backend/services/sessions`: private output/cancellation callbacks with fresh resources and authentication on each call.
- `@tabdo/backend/http/commands`: shared thin Hono route, including the public command allowlist and live membership check in the write transaction.
- `@tabdo/backend/errors`: transport-independent `ServiceError`; only HTTP entries map status to responses.
- Default entry: type exports only, without loading a database or auth runtime.

Node composition supplies its pool, environment settings, invitation hook and email transport. Do not close a resource while an accepted detached Run still uses it. Harness execution is assembled by the Node API/worker, while business services receive explicit dependencies.

```ts
import { createDatabase } from "@tabdo/backend/database";
const resource = createDatabase({ connectionString, poolMax: 1, prepare: true });
try { await useDatabase(resource.db); }
finally { await resource.close(); }
```

Integration checks live with application consumers: `test/routes/platform-factories.test.ts`, `test/commands/backend-services.test.ts` and `test/runner/explicit-services.test.ts`. They exercise real PostgreSQL, native Better Auth, signing isolation, explicit business transactions, leases and private outputs. Build dependencies with `pnpm build:foundation` and use an isolated `DATABASE_URL` ending in `_agent_test`; no remote credentials are required.

Node resource scopes live only in `apps/server/src/resources/scope.ts`; backend has no Node ambient types, ALS or global resource access. Deployment uses local Node or Railway with PostgreSQL/Redis; it does not require a second platform implementation.
