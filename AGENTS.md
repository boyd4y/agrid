# Repository Guidelines

## Project Structure & Module Organization

This pnpm workspace contains:

- `apps/client`: React, Vite, and TypeScript UI; assets in `public/`, translations in `src/i18n/locales/`.
- `apps/server`: Hono API, business operations in `src/commands/`, harness adapters, and BullMQ workers. PostgreSQL migrations live in `drizzle/`; bundled skills live in `skills/`.
- Remote MCP is served by the platform at `/mcp`; there is no local stdio MCP app.
- `packages/shared`: shared types and validation schemas.
- `packages/ui`: shared shadcn components, theme tokens, and Storybook.

Tests live in each package’s `test/` directory. Guides live in `docs/`.

## Build, Test, and Development Commands

Run with pnpm 9.15.0:

- `pnpm install`: install workspace dependencies.
- `pnpm dev`: build shared contracts and start client, server, and worker development processes.
- `pnpm build`: build workspace packages.
- `pnpm typecheck` and `pnpm typecheck:test`: validate application and test types.
- `pnpm test`: run package tests; server integration tests require an isolated database.
- `pnpm test:browser -- scheduled-sessions`: run a selected Playwright browser suite.
- `pnpm db:generate` / `pnpm db:migrate`: generate and apply migrations.
- `pnpm storybook`: preview shared UI components.

## Coding Style & Naming Conventions

Follow surrounding TypeScript formatting, generally two-space indentation. No repository-wide formatter or linter is configured. Use PascalCase for React components, `use...` for hooks, and camelCase for functions. Platform tool identifiers use snake_case; batch operations start with `batch_`.

Server relative imports use `.js` extensions. Client imports use `@/`; shared UI imports use `@tabdo/ui/components/*`. Reuse shared controls and semantic theme tokens. Update both English and Chinese translations for user-facing copy.

## Testing Guidelines

Unit and integration tests use Node’s test runner with `.test.ts` or `.test.mjs` filenames; browser suites use Playwright. Add regression coverage for meaningful behavior changes, including authorization and transaction boundaries.

Follow `docs/testing.md` for fixtures. Integration databases must end in `_agent_test`; queue tests require a dedicated `_queue_test` database, isolated Redis, and an `agrid-queue-test` prefix. Never run these tests against user data.

## Commit & Pull Request Guidelines

Use the existing conventions, such as `fix(chat): preserve agent binding` or `feat(schedules): add run history`. Keep independent changes in separate commits.

PR descriptions should explain the problem, resulting behavior, related issues, and validation performed. Identify migration or configuration changes and any unverified behavior.

## Configuration & Architecture

Start with `.env.example`; keep credentials out of Git. Business operations belong in the server command layer and shared contracts so client, MCP, and agent tools remain aligned. Let each harness provide its native runtime capabilities.

## Development and Production Release Boundary

Read [the release guide](docs/releases.md) before preparing or executing any release. It defines the human confirmation point, version tags, required configuration, automated steps, and recovery procedure.

Keep local development, test resources, and production operations separate. Ordinary development work must not require production backups, migrations, deployments, or production credentials. Keep necessary local checks and isolated CI tests.

Production changes require explicit human release confirmation. A normal commit, push, PR merge, or passing CI is not release approval. Do not create or push a production release tag, change production platform settings, stop production services, or run production migrations without that confirmation. An explicitly approved version tag may serve as the release confirmation once the release workflow is configured; do not infer approval from ordinary code-delivery instructions.

The dedicated tag-triggered production workflow automates preflight, eligible migration, deployment, and verification after a human confirms a version tag. A confirmed and pushed `vX.Y.Z` tag is the release approval; a second platform approval is optional. Railway's API and worker `master` autodeploys have been disconnected. The release path remains inactive until all prerequisites are verified, including the GitHub production environment, protected version tags, a publicly pullable GHCR package, the Railway project token, and snapshot quota; only then may `RELEASE_BOOTSTRAP_READY` be set to `true`. Do not create or push production tags before that setup is complete. See [the release guide](docs/releases.md) for setup, release and recovery steps.
