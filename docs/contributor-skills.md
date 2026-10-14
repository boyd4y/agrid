# Repository Skills

Repository skills have one source in `.agents/skills/`. Grok and Codex discover
this directory directly; Claude Code follows the committed per-skill links in
`.claude/skills/`. Edit the shared source so all three tools receive the same
instructions, references and scripts.

| Skill | Shared source | Claude entry |
| --- | --- | --- |
| Impeccable | `.agents/skills/impeccable/` | `.claude/skills/impeccable` |
| shadcn | `.agents/skills/shadcn/` | `.claude/skills/shadcn` |
| Tabdo operations | `.agents/skills/table-ops/` | `.claude/skills/table-ops` |

`skills/table-ops` remains a compatibility link to the shared source. Codex UI
metadata uses `agents/openai.yaml`. The existing Grok hook stays in its provider
configuration directory and invokes the shared Impeccable launcher. Skill
installation does not add or enable hooks in other providers.

For Impeccable, use the directory containing the loaded `SKILL.md` to resolve
scripts and references. For shadcn, run `pnpm shadcn info --json` from the repo
root; use `pnpm shadcn` for the client and `pnpm shadcn:ui` for shared UI. All
harnesses run these explicitly through their shell tool instead of relying on
Claude-only Markdown command interpolation.

The four product skills in `apps/server/skills/` remain SDK bundles managed by
Tabdo's Skill catalog; they are separate from contributor skill discovery.

Directory conventions are documented by [Grok Build](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md),
[Codex](https://learn.chatgpt.com/docs/build-skills), and
[Claude Code](https://code.claude.com/docs/en/skills).
