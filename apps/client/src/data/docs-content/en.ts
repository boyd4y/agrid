import type { DocsPage, DocsSection } from "./types";

export const docsSections: DocsSection[] = [
  { id: "welcome", title: "Welcome", description: "What tabdo is and how to start", audience: "both" },
  { id: "agents", title: "Setup for AI Agents", description: "MCP, Skill, and in-app tools", audience: "agents" },
  { id: "humans", title: "Setup for Humans", description: "Workspace UI and HTTP API", audience: "humans" },
  { id: "concepts", title: "Concepts", description: "Tables, members, views", audience: "both" },
  { id: "reference", title: "References", description: "Commands, REST, auth", audience: "ref" },
];

export const docsPages: DocsPage[] = [
  {
    slug: "welcome",
    sectionId: "welcome",
    title: "Welcome",
    description: "Agent-first talk-to-build. Tables stay the core data view. One command layer.",
    body: [
      {
        type: "p",
        text: "tabdo is agent-first talk-to-build: describe a system in chat and the agent creates tables, columns, automations, and formulas. Grid and board views remain the primary way to work with data — filters, kanban, and formulas are not reduced. The workspace UI, in-app assistant tools, external MCP/Skill connectors, and agent API keys all call the same command layer.",
      },
      {
        type: "callout",
        tone: "info",
        text: "Public docs need no login. Changing real data needs a signed-in session (people) or an agent API key (Authorization: Bearer agt_…).",
      },
      { type: "h2", text: "Get started" },
      {
        type: "cards",
        items: [
          {
            title: "For AI Agents",
            description: "External agents: MCP + Skill. In-product builders use built-in runtime tools.",
            href: "/docs/mcp",
            badge: "Agents",
          },
          {
            title: "For Humans",
            description: "/app opens talk-to-build and tables. Full grid, board, and filters stay on each table.",
            href: "/docs/human-quickstart",
            badge: "Humans",
          },
        ],
      },
      { type: "h2", text: "How it works" },
      {
        type: "p",
        text: "Every create, update, and move goes through server commands. There is no separate “agent API”. Permissions are org membership — user.kind is human or agent; member.role is the same for both.",
      },
    ],
  },
  {
    slug: "how-it-works",
    sectionId: "welcome",
    title: "How it works",
    description: "Discover schema → window-query rows → patch cells. One shared command layer.",
    body: [
      {
        type: "ol",
        items: [
          "getTable — schema + rowCount (never a full dump)",
          "queryRows — keyset window with filters / sort / board column",
          "updateCell / setStatus — patches with optional expectedVersion",
        ],
      },
      {
        type: "code",
        lang: "text",
        code: `┌─────────┐  ┌─────────────────────┐  ┌─────────────────┐  ┌──────────┐
│   UI    │  │ In-app runtime tools │  │ External MCP/Skill│  │ agt_ Key │
│ Grid/Bd │  │ (Codex/Claude/Pi)    │  │ (Claude/Cursor…)  │  │          │
└────┬────┘  └──────────┬──────────┘  └────────┬──────────┘  └────┬─────┘
     └──────────────────┴───────────┬──────────┴───────────────────┘
                                    ▼
                           POST /api/commands
                    (table features unchanged)`,
      },
    ],
  },
  {
    slug: "mcp",
    sectionId: "agents",
    title: "MCP",
    description: "Connect Claude, Codex, Cursor, or OpenCode to tabdo via MCP.",
    body: [
      {
        type: "p",
        text: "For external agents. The @tabdo/mcp package exposes every command as a snake_case tool (1:1 with in-app tools). Tools POST to /api/commands with your agent API key. The product UI does not use MCP — it uses built-in runtime tools.",
      },
      {
        type: "code",
        lang: "json",
        code: `{
  "mcpServers": {
    "tabdo": {
      "command": "pnpm",
      "args": ["--filter", "@tabdo/mcp", "start"],
      "env": {
        "TABDO_API_URL": "http://localhost:3001",
        "TABDO_API_KEY": "agt_your_key"
      }
    }
  }
}`,
      },
      {
        type: "ul",
        items: [
          "list_tables → listTables",
          "get_table → getTable",
          "query_rows → queryRows",
          "update_cell / update_cells / add_row / delete_row",
          "add_column / delete_column / update_column / reorder_columns",
          "set_status / move_card",
        ],
      },
      {
        type: "callout",
        tone: "warn",
        text: "Never load a full table. Agent query limit defaults to 50 (max 200).",
      },
    ],
  },
  {
    slug: "skill",
    sectionId: "agents",
    title: "Skill",
    description: "Install the tabdo skill in Cursor, Claude Code, and other agents.",
    body: [
      {
        type: "p",
        text: "For external agents. skills/table-ops/SKILL.md explains when to use MCP vs HTTP, how to paginate, and that select/person cells store ids. In-app talk-to-build already has runtime tools — no Skill install is required inside /app.",
      },
      {
        type: "ol",
        items: [
          "Copy or symlink skills/table-ops into your agent skills folder",
          "New in-app agents do not issue API keys; external MCP needs an existing credential",
          "Prefer MCP tools; fall back to POST /api/commands",
          "Always get_table before writing select / person cells",
        ],
      },
    ],
  },
  {
    slug: "harness",
    sectionId: "agents",
    title: "In-app runtime tools",
    description: "Codex / Claude / Pi with built-in tools — not MCP.",
    body: [
      {
        type: "p",
        text: "Inside tabdo (/app chat and the AI drawer), the assistant uses in-app runtimes (Codex, Claude, or Pi). Tools are registered in-process — the same command layer as MCP, but MCP is for external agents only.",
      },
      {
        type: "ul",
        items: [
          "Runtime switcher: Codex · Claude · Pi",
          "Built-in tools: list_tables, get_table, query_rows, update_cell, add_row, set_status, …",
          "No separate cloud assistant required; MCP is not needed for in-product chat",
          "External Claude / Cursor / Codex CLI → use MCP + Skill instead",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "Agent-first is the entry narrative. Full grid, kanban, filters, automations, and formulas remain first-class on each table page.",
      },
    ],
  },
  {
    slug: "agent-auth",
    sectionId: "agents",
    title: "Agents & authentication",
    description: "Create in-app agents with a signed-in session; no agent key is required.",
    body: [
      {
        type: "p",
        text: "Create an in-app agent with a name, persona, runtime, and model. Creation returns the agent configuration without an API key. In-app chat uses your signed-in session. Previously issued external credentials remain valid; issuing new external credentials is currently unavailable.",
      },
      {
        type: "code",
        lang: "bash",
        code: `curl -X POST http://localhost:3001/api/members/agents \\
  -H "Content-Type: application/json" \\
  -b cookies.txt \\
  -d '{"name":"Ops Bot","persona":{"defaultHarness":"codex"}}'`,
      },
    ],
  },
  {
    slug: "human-quickstart",
    sectionId: "humans",
    title: "Workspace UI",
    description: "Sign up, open /app, edit tables and boards.",
    body: [
      {
        type: "ol",
        items: [
          "Register at /signup (demo: demo@tabdo.ai / Demo1234!)",
          "Open /app — talk-to-build chat and table list",
          "Open a table for full grid / board / filters / formulas",
          "Invite people or create agents under Members / Agents",
          "Automations: /app/tables/:id/automations or the Automations hub",
        ],
      },
      {
        type: "callout",
        text: "Every UI change still hits the same command layer your agent will use.",
      },
    ],
  },
  {
    slug: "api-quickstart",
    sectionId: "humans",
    title: "HTTP API",
    description: "Call POST /api/commands from your own code.",
    body: [
      {
        type: "code",
        lang: "bash",
        code: `curl -s http://localhost:3001/api/commands \\
  -H "Authorization: Bearer agt_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"listTables","input":{}}'`,
      },
      {
        type: "p",
        text: "Prefer /api/commands for new integrations. REST under /api/tables is a thin alias over the same handlers.",
      },
    ],
  },
  {
    slug: "architecture",
    sectionId: "concepts",
    title: "Same-origin architecture",
    description: "UI · tools · MCP · API key share one command layer.",
    body: [
      {
        type: "p",
        text: "apps/server/src/commands is the only write implementation. HTTP, in-app tools, and external MCP are shells. Table product features (grid, board, filters) stay complete.",
      },
      {
        type: "callout",
        text: "Permissions only check org membership. user.kind does not fork the API.",
      },
    ],
  },
  {
    slug: "tables",
    sectionId: "concepts",
    title: "Tables, columns & rows",
    description: "Column types and JSONB cells built for 100k+ rows.",
    body: [
      {
        type: "table",
        headers: ["Type", "Cell value", "Notes"],
        rows: [
          ["text", "string | null", "Plain text"],
          ["number", "number | null", "Numeric compare / filter"],
          ["select", "optionId | null", "Store option id, not label"],
          ["multi_select", "optionId[]", "Array of ids"],
          ["date", "ISO date | null", "Calendar + typed input"],
          ["checkbox", "boolean", "Toggle"],
          ["person", "userId | null", "Human or agent"],
          ["formula", "computed", "Read-only; {Column} refs"],
        ],
      },
      {
        type: "callout",
        tone: "warn",
        text: "Large tables must use keyset cursors. Never OFFSET a full dump.",
      },
    ],
  },
  {
    slug: "members",
    sectionId: "concepts",
    title: "Members: humans & agents",
    description: "One user + member model; equal roles.",
    body: [
      {
        type: "ul",
        items: [
          "user — kind = human | agent",
          "member — role = owner | admin | member",
          "agent_profile — persona, default runtime, apiKeyHash",
          "invitation — human invites via email",
        ],
      },
    ],
  },
  {
    slug: "views",
    sectionId: "concepts",
    title: "Views, filters & board",
    description: "Grid, board, AND/OR filters, sorts.",
    body: [
      {
        type: "ul",
        items: [
          "Filters push down into Postgres JSONB",
          "Board columns window-load by status option",
          "Drag card ≡ setStatus / moveCard",
        ],
      },
    ],
  },
  {
    slug: "commands",
    sectionId: "reference",
    title: "Command API",
    description: "POST /api/commands — the single write entry.",
    body: [
      {
        type: "table",
        headers: ["command", "Purpose"],
        rows: [
          ["listTables", "List workspace tables"],
          ["getTable", "Schema + rowCount"],
          ["queryRows", "Keyset window query"],
          ["updateCell / updateCells", "Patch cells"],
          ["addRow / deleteRow", "Row lifecycle"],
          ["addColumn / deleteColumn / updateColumn", "Column lifecycle"],
          ["reorderColumns", "Column order"],
          ["setStatus / moveCard", "Board moves"],
        ],
      },
      {
        type: "code",
        lang: "json",
        code: `{
  "tableId": "…",
  "filters": [{ "id": "f1", "columnId": "…", "op": "eq", "value": "todo" }],
  "filterLogic": "and",
  "cursor": null,
  "limit": 50
}`,
      },
    ],
  },
  {
    slug: "rest",
    sectionId: "reference",
    title: "REST aliases",
    description: "Same handlers as the command layer.",
    body: [
      {
        type: "table",
        headers: ["HTTP", "Command"],
        rows: [
          ["GET /api/tables", "listTables"],
          ["GET /api/tables/:id", "getTable"],
          ["POST /api/tables/:id/rows/query", "queryRows"],
          ["PATCH /api/rows/:id", "updateCell / updateCells"],
          ["POST /api/tables/:id/rows", "addRow"],
          ["DELETE /api/rows/:id", "deleteRow"],
        ],
      },
    ],
  },
  {
    slug: "auth",
    sectionId: "reference",
    title: "Authentication",
    description: "Sessions and agent API keys.",
    body: [
      {
        type: "ul",
        items: [
          "Humans: email/password cookie session",
          "Agents: Authorization: Bearer agt_…",
          "AUTH_REQUIRED=true → 401 when missing",
        ],
      },
    ],
  },
];
