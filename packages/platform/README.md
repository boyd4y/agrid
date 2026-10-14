# @tabdo/platform

Shared Tabdo platform code, distinct from the generic queue/storage/harness/sandbox capabilities. This first extraction owns the PostgreSQL schema, explicit database resource factory and Better Auth factory.

- `@tabdo/platform/database`: `createDatabase({ connectionString, poolMax, prepare? })` returns Drizzle, its Postgres.js client and an owned `close()` method. No environment lookup or global pool.
- `@tabdo/platform/auth`: `createPlatformAuth({ database, appUrl, baseURL, secret, production, hooks?, sendInviteEmail })`. Both runtimes use the same native Better Auth/organization configuration; no replacement identity implementation.
- `@tabdo/platform/schema`: the single product schema and related types. SQL migrations stay in `apps/server/drizzle` during this incremental extraction.
- `@tabdo/platform/checkpoints`: private persisted workspace shape and validation contract. Actual filesystem snapshot/restoration and byte/path checks stay with the runtime.
- `@tabdo/platform/resources`: explicit `withPlatformResources({database, auth?}, work)` scope and strict DB/Auth accessors. No mutable default pool/auth; jobs can supply database-only scopes. Uses AsyncLocalStorage supported by Node and Workers nodejs_compat.
- Default entry: type exports only, without loading a database or auth runtime.

Node composition supplies its pool, environment settings, invitation hook and email transport. A Worker creates request-owned resources from its Hyperdrive binding and closes them after awaited database/auth work. Do not close a resource while an accepted detached Run still uses it. Long Harness execution belongs in the runner, not a short-lived Worker request.

```ts
import { createDatabase } from "@tabdo/platform/database";
const resource = createDatabase({ connectionString, poolMax: 1, prepare: true });
try { await useDatabase(resource.db); }
finally { await resource.close(); }
```

The actual integration checks remain with the application consumers: Node `test/routes/platform-factories.test.ts` and workerd `test/cloudflare/factories.test.ts`. They test real PostgreSQL, native Better Auth registration/sessions, independent signing settings and connection cleanup. Build dependencies with `pnpm build:foundation`, then run `pnpm --filter @tabdo/server test:edge` with an isolated `DATABASE_URL` ending in `_agent_test`; no remote credentials are required.

This package is intentionally partial. Business commands, repositories, Hono route assembly and agent-runtime are still being separated from the server. Existing server schema/factory imports are compatibility re-exports, not another schema. A successful factory test does not mean the full Tabdo API or Cloudflare runner is deployable yet.
