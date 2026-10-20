# Tabdo on Railway

`railway.ts` manages `api` and `worker` under the `tabdo-app` partial and references
the existing Railway Redis. Database services and their volumes remain outside
application ownership, so applying this file cannot delete unrelated data services. Both
application services build the repository root with `Dockerfile.server`. The API
also serves the built React app. PostgreSQL and private S3 storage remain on Neon.

## Environment separation

- `pnpm dev`, migrations, and Demo seeds use `.env.development` and local services.
- Railway injects production variables. No `.env` files or Neon CLI state enter
  the image. `.env.production` is only a private local source for explicit
  deployment administration; never commit it or upload it as source.
- The deployed services set `NODE_ENV=production`, `TABDO_ENV=production`,
  `AUTH_REQUIRED=true`, and `QUEUE_PREFIX=tabdo-production`.

## Release ownership and one-time setup

Production application deployments are owned by the confirmed-version-tag release
workflow. Do not deploy application source with `railway up`, apply this source
configuration to production, or rely on a GitHub `master` autodeploy. An
administrator must disable the existing `master` autodeploy for both application
services and image auto updates once, clear their old migration pre-deploy hook,
configure the GitHub `tabdo / production` Environment, verify the Neon and
Railway targets, and enable the repository bootstrap guard only after those
checks pass. Applying `.railway/railway.ts` does not perform these remote changes.
See [the release guide](../docs/releases.md) for the exact
secrets, variables and confirmation flow. The remote release path is not active
until that setup is completed.

The administrator must verify that `ghcr.io/boyd4y/agrid` exists and is publicly
pullable on the current Railway Hobby plan. Its existence and visibility have not
been verified. If it does not exist, create it with a one-time image push from a
confirmed source commit as described in [the release guide](../docs/releases.md);
keep `RELEASE_BOOTSTRAP_READY=false` and do not create a release tag during this
initialization. The release workflow checks anonymous digest access before
changing service image sources. API and worker must receive the same immutable
image digest. Do not put secrets or production configuration in the image.

Create active GitHub tag rulesets for `v*`: allow only designated release
maintainers to create tags, and configure a separate update/deletion rule with no
bypass actors so existing release tags cannot be rebound or deleted. If an
emergency exception is needed, require an administrator to change the rules
deliberately and retain an audit trail. GitHub Environment required reviewers can
be enabled as optional additional protection. The confirmed and pushed `vX.Y.Z`
tag is the normal release approval; do not require a duplicate approval by
default.

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
