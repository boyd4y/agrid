# @tabdo/agent-runtime

Node implementation of the official Vercel Harness execution lifecycle, shared by
API chat and worker-triggered agent tasks.

- `/harness/*`: official Pi, Claude Code and Codex SDK assembly.
- `/sandbox/*`: real local files/processes and official Vercel Sandbox sessions.
- `/execution`: streaming, cancellation, tool results and session checkpoints.
- `/services`: injected business persistence, authorization and tool services.
- `/workspace`: local workspace snapshot and cold restore.
- `/errors`: safe tool and chat error projection.

There is one Node deployment path for local development and Railway. Pi's loop
runs in Node; Claude/Codex use the official remote Sandbox bridge. Local execution
uses host permissions, not OS isolation. Each Run may construct a new HarnessAgent;
PostgreSQL holds durable session/run state, not a permanently resident JS object.

Run `pnpm --filter @tabdo/agent-runtime test` for native Pi tool loops, SDK retry
behavior, history and real filesystem lifecycle. Tests use local protocol fixtures,
not paid models or production data. Product/database tests remain in
`apps/server/test/harness/` with an isolated `_agent_test` database.
