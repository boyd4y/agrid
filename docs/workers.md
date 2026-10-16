# Production worker Compose contract (#7 / P1-05)

`docker-compose.workers.yml` runs `node dist/queue/main.js` with
`NODE_ENV=production`. The worker imports Better Auth through command execution,
so **BETTER_AUTH_SECRET is required to start**, even for rules without agents.
Use the API's secret: a random value of at least 32 characters, never the example
placeholder or a repeated character. Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Set `BETTER_AUTH_URL` to the API origin and `APP_URL` to the frontend origin,
matching the API deployment; empty values retain the application's local defaults.

Supply values through exported host environment variables or a protected host
`.env.production` / Compose `--env-file .env.production`. Compose explicitly injects the listed variables;
an env file alone does not forward every variable to the container. Production
must not rely on a baked `.env`: `.dockerignore` excludes it. Do not copy secrets
into the image or commit deployment env files. See `.env.production.example` for deployment variables and `.env.example` for optional provider settings. Local `pnpm dev` uses `.env.development` and never reads this deployment configuration.

The existing `DATABASE_URL`, `REDIS_URL`, `QUEUE_PREFIX`, `DB_POOL_MAX`,
`WORKER_CONCURRENCY`, and `QUEUE_GLOBAL_CONCURRENCY` settings are preserved.
Database and Redis default to the Compose network services; use
`QUEUE_DATABASE_URL` / `QUEUE_REDIS_URL` for external services. The API and workers
must share the database, Redis, and queue prefix. Apply database migrations before
starting workers and budget connections across replicas.

Normal work is driven by Redis notifications sent after PostgreSQL commits.
Scheduled work and outbox retries use delayed messages. Startup and the default
15-minute safety sweep recover lost notifications/deliveries; configure
`AUTOMATION_RECOVERY_INTERVAL_MS` to change this recovery-latency tradeoff.
The former `AUTOMATION_RELAY_POLL_MS` setting is no longer used. An idle worker
does not continuously query PostgreSQL, allowing Neon to suspend between work
and recovery sweeps. Redis must remain available and the worker must remain running.

Optional capability requirements (missing credentials do not prevent basic startup):

- `run_agent`: configure the selected provider: `OPENAI_API_KEY` (or
  `CODEX_API_KEY`), `ANTHROPIC_API_KEY`, `PI_API_KEY` plus `PI_BASE_URL`, or
  `OPENROUTER_API_KEY`. Corresponding base URLs, model selections, and Pi limits
  are passed through. Codex and Claude Code also require `VERCEL_TOKEN`,
  `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`, or `VERCEL_OIDC_TOKEN`.
  Pi requires Vercel credentials only for sandbox mode.
- AgentMail: `INTEGRATION_ENCRYPTION_KEY` must be the same stable 32-byte hex or
  base64 key used by the API to encrypt stored credentials. `WEBHOOK_PUBLIC_URL`
  supplies the reachable HTTPS origin for hook registration (falls back to
  `APP_URL`); it is not a worker startup requirement.
- Files: match the API's `FILE_STORAGE_DRIVER`. Local storage defaults to
  `/app/data/files` on `uploaded_files`; the API must share that volume. An
  overridden `FILE_STORAGE_LOCAL_DIR` is a container path and needs a matching
  shared mount. S3 needs `FILE_STORAGE_S3_BUCKET` and the same endpoint/region
  configuration as the API; provide both S3 access/secret keys or configure the
  AWS credential chain in the container. Upload limits also pass through.

## Smoke checklist

1. Prepare the host env with a real auth secret and any capabilities you use.
   After starting PostgreSQL, apply `pnpm db:migrate` against the same database
   using a host-reachable `DATABASE_URL`.
2. Validate interpolation locally with
   `docker compose -f docker-compose.yml -f docker-compose.workers.yml config --quiet`.
   Avoid sharing rendered config output, which can contain secrets.
3. Build and start:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.workers.yml up -d --build
   docker compose -f docker-compose.yml -f docker-compose.workers.yml ps
   docker compose -f docker-compose.yml -f docker-compose.workers.yml logs --tail=100 worker
   ```
4. Confirm Redis is healthy, the worker remains running without increasing restart
   counts, and logs contain `[queue] started automation`. The worker has no HTTP
   health endpoint; this log follows queue readiness. There must be no
   `BETTER_AUTH_SECRET` exception or auth crash loop. Check for database/relay
   errors too; the queue readiness log alone does not prove migrations are applied.
5. Trigger a simple `update_field` automation and verify completion. If enabled,
   separately exercise `run_agent`, AgentMail credential hydration, and file access
   with the configured provider/storage; startup alone does not validate them.
