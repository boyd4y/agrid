# tabdo · AI 原生工作空间

## Positioning
tabdo is an **AI-native workspace** for individuals and small teams. Flexible structured data provides the foundation; agents help people organize information, arrange steps, and execute operations around what they want to do. People can inspect and adjust the results through the product's interfaces.

The name **tabdo.ai** connects **Table → Do → AI**: data, action, and AI-native orchestration. Table names the underlying data foundation, rather than the product category. Do emphasizes work that leads to concrete changes and results. AI is the native way to design and operate that work.

Primary message: **让想法，动起来。** Full positioning and copy: [docs/brand/positioning.md](docs/brand/positioning.md).

## Audience
- Individuals organizing personal projects, information, and plans
- Small teams arranging shared work and keeping track of progress
- Users describing their goals to in-product agents; external agent access is an integration capability, rather than the audience definition

## Purpose
Describe an idea and provide relevant information → an agent organizes the information and steps → tools execute concrete operations → people inspect and adjust results. Tables, boards, forms, automations, and reports provide appropriate surfaces for that work. CRM is one example, alongside personal plans and shared projects.

## Information architecture
| Surface | Role |
|---|---|
| `/` marketing | Ideas → organized information and steps → action and adjustment |
| `/docs` | Dual entry: **For AI Agents** (MCP/Skill) · **For Humans** (UI/API) |
| `/blog` | Public SEO + llms.txt |
| `/app` | Agent workspace with on-demand resource panels |
| `/app/tables/:id` | Full grid/board inspector (core data view) |
| MCP + Skill | External agents only |
| Vercel harness in `/api/chat` | Internal agent; built-in tools (not MCP) |

## Operating context
Web app. Public marketing/docs/blog. Authenticated workspace with left nav; `/app` opens chat-build beside table.

## Constraints
- UI: shadcn/ui + Tailwind semantic tokens; no native form controls
- One command layer (`POST /api/commands`); no forked agent API
- Shared domain commands for UI and agent mutations; external MCP coverage is tracked separately in ITERATIONS.md
- Brand: **tabdo**
- Primary brand domain: **tabdo.ai**; alternate domain: **tabdo.dev**

## Voice
Plain, approachable, and concrete. Lead with ideas, plans, and action. Explain flexible data as the foundation and Agent-first as the product strategy. Avoid enterprise workflow language, competitor aesthetics as positioning, spreadsheet-first slogans, framework jargon, and claims of capabilities that are not implemented.
