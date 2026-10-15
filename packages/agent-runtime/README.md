# @tabdo/agent-runtime

Official Harness and execution-environment capabilities for Node.

- `/harness/*`: official Pi, Claude Code and Codex SDK assembly.
- `/sandbox/*`: real local files/processes and official Vercel Sandbox sessions.
- `/workspace`: safe filesystem snapshot and cold restore.

This package depends on generic core contracts and official SDKs. It has no
Tabdo Actor, Run, Session repository, database, shared product or application
imports. Workspaces, authorization, tool transactions, run activity and checkpoint
persistence are composed by `apps/server/src/harness` and `src/business`.

Pi's loop runs in Node; Claude/Codex use the official remote Sandbox bridge. Local
execution uses host permissions, not OS isolation. Local and Railway share one
Node deployment path.

Run `pnpm --filter @tabdo/agent-runtime test` for native tool loops, SDK retries,
history and filesystem lifecycle, using local provider fixtures. Product-level
execution tests stay in `apps/server/test/harness/` with an isolated `_agent_test`
database. Remote Sandbox/model acceptance is separate.
