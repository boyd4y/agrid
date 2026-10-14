# @tabdo/platform-node

Node implementations of generic capabilities. No Cloudflare bindings or Tabdo schema/permissions.

Use explicit subpaths:

- `/queue/bullmq`: publication, queue ownership and cleanup; application names/payloads are injected.
- `/storage/local`, `/storage/s3`: generic object bytes and keys.
- `/execution/node-process`, `/execution/node-worker`: trusted computing references and process lifecycle.
- `/harness/agent`, `/harness/pi`, `/harness/codex`, `/harness/claude-code`: official native SDK assembly.
- `/harness/types`, `/sandbox/types`: specialize core contracts with official SDK types.
- `/sandbox/local`, `/sandbox/vercel`: native SDK environment lifecycle.

The default entry exports types only. A Cloudflare Sandbox can load the Harness/execution modules inside its Linux image; its Worker must not import this package. Loading those subpaths does not load BullMQ. The container program is an internal execution entry, not an additional public Node service or another agent loop.

Tests run with `pnpm --filter @tabdo/platform-node test`. Set `QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381` to include the real isolated BullMQ test. No test calls a paid model or a user database. Cloudflare Sandbox lifecycle and business dispatch require their separate integration tests.
