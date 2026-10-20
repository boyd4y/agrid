# Tabdo on Railway

Railway directly deploys the `master` branch of `boyd4y/agrid`. The API and worker are separate services; both use the repository root `Dockerfile.server` and have autodeploy enabled. Wait for CI/check suites is disabled (`checkSuites=false`), so Railway builds and deploys on a `master` update without GitHub Actions or cloud CI as a prerequisite. Production deployment, runtime, database, and Neon administration credentials stay in Railway.

## Branches and release confirmation

Feature branches merge into `develop` for daily integration after necessary local checks and independent review. A human confirms a production release by approving the merge of the prepared changes into `master`. Ordinary development agents must not push directly to `master`. Version tags, manual deploy commands, source uploads, GitHub Actions, and custom deployment API orchestration are not part of this flow. See [the release guide](../docs/releases.md).

## Environment separation

- Local development and isolated tests use `.env.development` and local/test resources.
- Production runtime variables and secrets stay in Railway. Do not commit `.env` files or production values.
- Production services set `NODE_ENV=production`, `TABDO_ENV=production`, `AUTH_REQUIRED=true`, and `QUEUE_PREFIX=tabdo-production`.

## Database migration and independent deployments

The API Railway `preDeploy` checks the existing migration plan. With no pending migrations it skips both snapshot creation and the migrator. With pending migrations it requires compatibility approval and the reviewed SQL hash, creates and verifies a Neon snapshot, runs the existing migrator, then reads back the migration ledger. Failures stop the API deployment; the process does not automatically restore the database.

Railway deploys API and worker independently after a `master` update; the platform does not guarantee that API finishes first. The worker `preDeploy` performs a read-only migration check and waits for the API migration to complete. It does not create snapshots, run migrations, or use Neon administration credentials. Use the exact worker command and timeout in [the Railway IaC file](railway.ts); do not infer deployment order from environment variable references.

Production database/runtime variables and the API-only Neon snapshot credentials are stored in Railway. Keep production credentials out of the repository and local development. Migration changes must remain compatible with old API/worker instances that may still be running during deployment.

## Verification status

The two-branch deployment flow still needs end-to-end verification. Confirm that `develop` updates do not trigger production deployment; then verify a manually confirmed `master` merge, Railway Dockerfile builds, API migration behavior for both pending and no-pending cases, worker read-only waiting, and API/worker health. Do not report production verification as complete until those checks have been run.
