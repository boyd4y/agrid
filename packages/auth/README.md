# @tabdo/auth

Better Auth identity services, independent of Tabdo product schemas.

- Root: `createAuth`, signing-secret validation and the inferred `Auth` type.
- `/schema`: user, session, account, verification, organization, member,
  invitation and personal API credentials.
- `/actor`: cookie/personal-key identity resolution with live membership checks.
- `/api-keys`: list, create and physically delete user-owned API credentials.

Pass database resources, origins, signing configuration and invitation email hooks
explicitly. Plaintext API keys are returned only when created; only their hashes
are stored. Keys retain the associated user's organization access.

Product credential extensions use `resolveBearer`; only server code looks up
legacy agent profiles. Member avatars, agent personas, skill selection and table
permissions remain in `apps/server/src/business`.

All tables retain their existing SQL names/constraints. The server aggregates the
complete schema for one database; extracting this package adds no deployment
service or database migration.

Run `pnpm --filter @tabdo/auth test`. Real PostgreSQL/session/authorization coverage
also runs in `apps/server/test/routes/` against an isolated `_agent_test` database.
