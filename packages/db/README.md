# @tabdo/db

PostgreSQL connection pools and schema-parameterized Drizzle initialization.

```ts
import { createDatabase } from "@tabdo/db";
const resource = createDatabase({ connectionString, poolMax: 4, schema });
try { await runQueries(resource.db); }
finally { await resource.close(); }
```

The caller supplies configuration and owns resource shutdown. This package exports
`Database`, `Transaction` and `DatabaseResource` types without importing auth or
product tables. The application combines auth and business schemas against the
same PostgreSQL database. Migration files remain in `apps/server/drizzle`.

Run `pnpm --filter @tabdo/db test`. Default tests compile queries for an unrelated
schema without connecting to a database or changing user data.
