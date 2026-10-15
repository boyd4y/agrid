# @tabdo/platform-node

Node implementations of generic capabilities, independent of Tabdo schema and permissions.

Use explicit subpaths:

- `/queue/bullmq`: publication, queue ownership and cleanup; application names/payloads are injected.
- `/storage/local`, `/storage/s3`: generic object bytes and keys.
- `/execution/node-process`, `/execution/node-worker`: trusted computing references and process lifecycle.
- `/harness/agent`, `/harness/pi`, `/harness/codex`, `/harness/claude-code`: official native SDK assembly.
- `/harness/types`, `/sandbox/types`: specialize core contracts with official SDK types.
- `/sandbox/local`, `/sandbox/vercel`: native SDK environment lifecycle.

The default entry exports types only. Local development and Railway load the same explicit Node subpaths; Harness assembly does not implicitly load BullMQ. Pi runs its native loop in the host. Claude/Codex use the official remote Sandbox bridge. See `docs/architecture/node-harness.md` for execution and lifecycle boundaries.

Tests run with `pnpm --filter @tabdo/platform-node test`. Set `QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381` to include the real isolated BullMQ test. No default test calls a paid model or a user database; remote Sandbox acceptance is opt-in.
