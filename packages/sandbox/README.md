# @tabdo/sandbox

Lifecycle adapters using the official SDK network sandbox session and create/resume types. File, command and port operations call that SDK session directly; this package does not define another file/tool API.

- `adapters/local`: JustBash with explicit cwd/environment and caller-provided filesystem creation/restoration. Resume refuses to fabricate an empty workspace when no restorer is supplied.
- `adapters/vercel`: official Vercel create/lookup lifecycle, explicit provider settings and native templates. No network request occurs during adapter construction.

```ts
import { createLocalSandboxAdapter } from "@tabdo/sandbox/adapters/local";
const adapter = createLocalSandboxAdapter({ cwd: "/project", env: {},
  createFilesystem, restoreFilesystem });
const { session, workspace } = await adapter.create({ sandboxId: executionId });
```

Applications own references, workspace checkpoints, limits, credentials, lease/fence and lifetime. The default entry imports no Node/vendor runtime; concrete dependencies are optional peers selected through subpaths. Local cannot serve bridge harnesses requiring a network port. Sandbox environment and the full Harness control process are separate; this package alone does not move a host Pi into a remote runner.

`pnpm --filter @tabdo/sandbox test` validates a real local native session and cold workspace restoration callback. Current Vercel calls retain the existing official implementation but have not been revalidated against a live remote account. Cloudflare and E2B adapters and a full process execution provider remain subsequent architecture stages; no placeholder successful providers are exposed.
