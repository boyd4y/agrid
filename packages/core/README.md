# @tabdo/core

Business-independent services used by the Node application and capability packages.

- `/services`: injectable clock and ID generation.
- `/errors`: service/configuration errors without HTTP entry dependencies.
- `/crypto`: stable SHA-256 credential digest representation.
- `/tasks/schedule`: cron and IANA timezone calculations.
- `/tasks/lease`: expiring resource leases, renewal and shared concurrency limits;
  receives an atomic store and caller-owned keys.
- `/workspace`: filesystem snapshot data contract.

Core does not import auth, database schemas, agent profiles, tables, automations,
shared product contracts, or application code. Queue publication and object bytes
remain in their capability packages. Database connections belong to `@tabdo/db`.

Run `pnpm --filter @tabdo/core test` and `pnpm check:architecture`.
