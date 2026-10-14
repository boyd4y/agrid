# @tabdo/backend

Shared Tabdo business code, separate from `core` contracts and the Node/Cloudflare implementation packages. This extraction owns the PostgreSQL schema, database resource and Better Auth factories, checkpoint contracts and explicit identity services.

- `@tabdo/backend/database`: `createDatabase({ connectionString, poolMax, prepare? })` returns Drizzle, its Postgres.js client and an owned `close()` method. No environment lookup or global pool.
- `@tabdo/backend/auth`: `createPlatformAuth({ database, appUrl, baseURL, secret, production, hooks?, sendInviteEmail })`. Both runtimes use the same native Better Auth/organization configuration; no replacement identity implementation.
- `@tabdo/backend/schema`: the single product schema and related types. SQL migrations stay in `apps/server/drizzle` during this incremental extraction.
- `@tabdo/backend/checkpoints`: private persisted workspace shape and validation contract. Actual filesystem snapshot/restoration and byte/path checks stay with the runtime.
- `@tabdo/backend/auth/actor`: `resolveActor(request, {database, resolveSession, logger})` and `listOrgMembers(organizationId, {database})`. Explicit dependencies, Web Crypto, live membership/key checks and no ALS or Hono dependency. Node compatibility façades preserve existing public call signatures.
- `@tabdo/backend/resources`: explicit `withPlatformResources({database, auth?}, work)` scope and strict DB/Auth accessors. No mutable default pool/auth; jobs can supply database-only scopes. Uses AsyncLocalStorage supported by Node and Workers nodejs_compat.
- Default entry: type exports only, without loading a database or auth runtime.

Node composition supplies its pool, environment settings, invitation hook and email transport. A Worker creates request-owned resources from its Hyperdrive binding and closes them after awaited database/auth work. Do not close a resource while an accepted detached Run still uses it. Long Harness execution belongs in the runner, not a short-lived Worker request.

```ts
import { createDatabase } from "@tabdo/backend/database";
const resource = createDatabase({ connectionString, poolMax: 1, prepare: true });
try { await useDatabase(resource.db); }
finally { await resource.close(); }
```

The actual integration checks remain with the application consumers: Node `test/routes/platform-factories.test.ts` and workerd `test/cloudflare/factories.test.ts`. They test real PostgreSQL, native Better Auth registration/sessions, independent signing settings and connection cleanup. Build dependencies with `pnpm build:foundation`, then run `pnpm --filter @tabdo/server test:edge` with an isolated `DATABASE_URL` ending in `_agent_test`; no remote credentials are required.

This package is intentionally partial. Business commands, repositories, Hono route assembly and agent-runtime are still being separated from the server. Existing server schema/factory imports are compatibility re-exports, not another schema. The legacy `/resources` scope is transitional; new services must receive explicit dependencies. A successful factory test does not mean the full Tabdo Worker or Sandbox dispatch is deployable yet.
