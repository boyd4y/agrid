# Tabdo on Railway

`railway.ts` declares three resources: `api`, `worker`, and Railway Redis. Both
application services build the repository root with `Dockerfile.server`. The API
also serves the built React app. PostgreSQL and private S3 storage remain on Neon.

## Environment separation

- `pnpm dev`, migrations, and Demo seeds use `.env.development` and local services.
- Railway injects production variables. No `.env` files or Neon CLI state enter
  the image. `.env.production` is only a private local source for explicit
  deployment administration; never commit it or upload it as source.
- The deployed services set `NODE_ENV=production`, `TABDO_ENV=production`,
  `AUTH_REQUIRED=true`, and `QUEUE_PREFIX=tabdo-production`.

## First deployment

1. Run `railway login`, then inspect `railway list` and link the intended project
   and production environment with `railway link`.
2. Set production secrets on **both** application services before starting them.
   Use `railway variable set KEY --stdin --service api --skip-deploys` (and worker)
   to avoid putting secret values in shell history. Never print variable-list JSON.
3. Review `railway config plan`, then apply the reviewed configuration. Existing
   resources must be retained; do not confirm deletion of unrelated services.
4. Deploy current source from the repository root with `railway up --service api`
   and `railway up --service worker`. Alternatively, push the reviewed version to
   the configured GitHub branch for automatic deployment.
5. Create an API domain with `railway domain --service api`. Set `APP_URL`,
   `BETTER_AUTH_URL`, and optionally `WEBHOOK_PUBLIC_URL` to its HTTPS origin on
   both services, then redeploy. The worker needs no public domain.

Shared production variables:

- `DATABASE_URL`: Neon pooled connection; `DATABASE_URL_UNPOOLED`: direct endpoint
  used by the API's pre-deploy migration command.
- `REDIS_URL`: the Railway Redis private reference, shared queue prefix.
- `BETTER_AUTH_SECRET` and `INTEGRATION_ENCRYPTION_KEY`: stable independent secrets;
  never reuse development secrets or rotate an existing encryption key casually.
- `FILE_STORAGE_DRIVER=s3`, `FILE_STORAGE_S3_BUCKET`, `AWS_ENDPOINT_URL_S3`,
  `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: existing Neon storage.
- `PI_API_KEY`, `PI_BASE_URL`, `PI_MODEL`: DeepSeek configuration. Each agent's
  saved model must also be valid for that provider.

`NEON_API_KEY` is an administration credential and is not needed by the services.
Do not run Demo seeds as a deployment hook.

## Verification

Check deployment status and bounded service logs, HTTPS `/api/health`, frontend
navigation and login. Verify a temporary automation reaches a completed run and
writes its expected value, then remove its temporary table. Upload, download, and
remove a temporary file through the application to verify private S3 storage.
Finally, test one real agent turn and its persisted session. A successful image
build or healthcheck alone does not verify queues, storage, or model execution.
