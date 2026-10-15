# Native Harness container fixture

This is a local acceptance fixture for the Cloudflare deployment architecture. It is not the production product Run entry, and does not connect to PostgreSQL or charge a model provider.

Run from `apps/cloudflare`:

```sh
pnpm exec wrangler types sandbox/fixture/env.d.ts --config sandbox/fixture/wrangler.jsonc --env-interface NativeSandboxFixtureEnv --include-runtime=false
pnpm exec tsc -p sandbox/tsconfig.worker.json
pnpm exec tsc -p sandbox/tsconfig.node.json
pnpm exec tsx --test sandbox/local.test.ts
```

Docker must be running. Wrangler builds a `linux/amd64` Node 24 image with independently pinned fixture dependencies and `npm ci` against the fixture lockfile. It copies the current `core` and `platform-node` source, using explicit Node execution subpaths and the development condition; it does not use monorepo `dist` or a separate Node API. The first run downloads the image and dependencies. Only fixture containers are stopped; cached images remain.

The real test path is workerd → Durable Object → `ctx.container.start()` → container `exec()` → official `HarnessAgent` / `@ai-sdk/harness-pi`. A mock model listens inside the container with Internet access disabled. The native tool writes a marker, and the official question tool suspends the turn. The entry detaches and exports native continuation plus its real filesystem workspace. The DO saves this small fixture checkpoint, waits for the process to exit, destroys the container, then creates another container and resumes the native question. The answer is supplied once, the original user input is not replayed, and the marker remains `1`.

`resource-ready` proves only that the computing process started. A returned checkpoint proves SDK capture. Neither event replaces the product's PG acceptance, invocation fence, tool receipts, or final Run transaction. DO checkpoint storage is only a test transport; production uses the shared PG/R2 contract. The output is bounded, and stdout is flushed before exit.

The fixture uses the current [Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/) and [`durable_object` scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policies/). `start()` does not certify process readiness; `exec()` waits for startup. Request disconnect is not wired to an execution abort signal. Native process termination and explicit container destruction are separate from business cancellation.

Local validation does not certify remote placement, cold-start billing, production tool gateway permissions, other Harness adapters, or snapshot portability. [`@cloudflare/sandbox` 1.x](https://developers.cloudflare.com/sandbox/reference/) provides optional file helpers; this fixture needs no helper package or old `getSandbox()` API.

The runner uses real `node:fs` files and `bash` child processes; it does not include a Bash interpreter or memory filesystem. Each instance owns a fresh temporary directory. Snapshots store portable logical paths and restore into a new directory before the official SDK resumes.
