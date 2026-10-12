# Agrid · Agent-first 数据系统

## Positioning
Agrid is an **Agent-first Talk-to-Build** product. Postgres multidimensional tables are the **core data layer and primary display**; conversation (and MCP for external agents) is how systems get built and mutated. Not “AI bolted onto a spreadsheet UI.”

## Audience
- Teams that want humans + agents on one command layer
- External agents (Claude / Codex / Cursor) via MCP + Skill
- In-product builders using Vercel AI harness (Codex / Claude / Pi) with **built-in tools**

## Purpose
Talk-to-Build: describe a CRM, ops board, or internal tool in chat → agent creates tables, columns, automations, formulas. Humans inspect and edit in **Grid / Board** (the core view). Same commands power UI, harness tools, MCP, and `agt_` keys.

## Information architecture
| Surface | Role |
|---|---|
| `/` marketing | Agent-first narrative + table-as-core data |
| `/docs` | Dual entry: **For AI Agents** (MCP/Skill) · **For Humans** (UI/API) |
| `/blog` | Public SEO + llms.txt |
| `/app` | Default: **Talk-to-Build chat + live table** |
| `/app/tables/:id` | Full grid/board inspector (core data view) |
| MCP + Skill | External agents only |
| Vercel harness in `/api/chat` | Internal agent; built-in tools (not MCP) |

## Operating context
Web app. Public marketing/docs/blog. Authenticated workspace with left nav; `/app` opens chat-build beside table.

## Constraints
- UI: shadcn/ui + Tailwind semantic tokens; no native form controls
- One command layer (`POST /api/commands`); no forked agent API
- Internal harness tools ≡ external MCP tools ≡ UI mutations
- Brand: **Agrid**

## Voice
Calm, Notion-warm. Emphasize “对话构建 · 表格落盘” over “多维表格套壳 AI.”
