# Migration repair (#8 / P1-06)

Back up the database before migrating, especially before attributing or deleting
orphan data. Stop application writers and run `pnpm db:migrate` from the repo root.

The journal originally placed 0002–0005 before 0001 in timestamp order. Their
`when` values are now 1791691000000, 1791692000000, 1791693000000 and
1791694000000 respectively; idx, tags and all other timestamps are unchanged.
A database with only 0000/0001 recorded can now run the normal ordered sequence.

The runner uses individual SHA256/tag/entry timestamp records, never a timestamp
watermark. It also checks schema presence for 0002–0005 even when recorded.
Original 0002–0005 timestamps and legacy tag hashes are recognized. Repairs append
real SQL hashes with journal timestamps; existing records are preserved. The
whole run holds a transaction advisory lock and commits atomically. A failure
rolls back the run, including orphan resolution. Do not run older migrators
concurrently; they do not honor this lock.

If tables have NULL organization_id, the default is to abort with their count.
After reviewing the backup and tenant ownership, either:

- Set `MIGRATION_ORPHAN_ORG_ID=<existing-organization-id>` to explicitly map all
  orphan tables to that tenant. An invalid id aborts, even if deletion is enabled.
- Set `MIGRATION_ALLOW_ORPHAN_DELETE=true` to explicitly delete orphan tables and
  their dependent data. The runner logs explicit deletion counts; other FK
  dependents follow CASCADE/SET NULL. This is destructive.

Empty databases and already-NOT-NULL tables need no policy. The revised 0004 SQL
only sets NOT NULL and fails if orphans remain. Previously applied 0004 history
is not rewritten; historical tenant assignments/deletions cannot be undone by
this repair. Logs describe operations pending transaction commit.

For databases that reached 0006+ while skipping earlier entries, missing perf
indexes and nullable org attribution are repaired independently of the ledger.
Missing automation tables alongside queue-era schema abort clearly: recreating
0003 would restore obsolete foreign keys and omit later automation columns.
Restore a consistent backup or audit/rebuild that schema before retrying. Later
missing schema (0006–0024) with existing ledger records requires operator audit;
this runner does not blindly replay non-idempotent later SQL. Startup readiness
checks critical tables, org scoping, and 0024 name constraint triggers. A database
with forged Date.now records and SHA/tag hashes is handled by individual records;
unrecognizable ledger entries or manually modified schemas require review.

Focused verification:
`pnpm --filter @tabdo/server exec tsx --test test/migrations/migrations.test.ts`.
Run the disposable PostgreSQL script with a CREATEDB-capable account:
`MIGRATION_TEST_DATABASE_URL=postgresql://… pnpm --filter @tabdo/server exec tsx test/migrations/postgres-matrix.ts`.
It verifies empty/latest, 0001-only, orphan abort/rollback, invalid/valid mapping,
and historical index repair. Additionally verify this matrix:

| Fixture | Expected result |
| --- | --- |
| Empty database | All 25 entries apply; second run makes no changes |
| 0000/0001 SQL and original 0001 watermark recorded | 0002–0024 apply |
| Same, with orphan tables and no env policy | Abort with count; transaction rolls back |
| Same, valid mapping / invalid mapping / explicit delete | Map / abort / delete, respectively |
| Latest database | No SQL replay or ledger changes |
| Latest watermark but missing perf indexes or nullable org | Historical schema repair |
| Queue-era schema with missing automations | Explicit recovery error |

Run database fixtures against isolated databases, never production. Unit tests
cover journal order and orphan policy without requiring PostgreSQL.
