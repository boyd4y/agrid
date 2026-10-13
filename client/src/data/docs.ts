import { BRAND } from "@/lib/brand";

export type DocsSection = {
  id: string;
  title: string;
  description: string;
  /** monid-style audience grouping */
  audience?: "agents" | "humans" | "both" | "ref";
};

export type DocsPage = {
  slug: string;
  sectionId: string;
  title: string;
  description: string;
  body: DocsBlock[];
};

export type DocsBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "callout"; tone?: "info" | "warn"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | {
      type: "cards";
      items: { title: string; description: string; href: string; badge?: string }[];
    };

export const docsSections: DocsSection[] = [
  {
    id: "welcome",
    title: "Welcome",
    description: "What tabdo is and how to start",
    audience: "both",
  },
  {
    id: "agents",
    title: "Setup for AI Agents",
    description: "External MCP/Skill; in-app harness tools",
    audience: "agents",
  },
  {
    id: "humans",
    title: "Setup for Humans",
    description: "Workspace UI and HTTP API",
    audience: "humans",
  },
  {
    id: "concepts",
    title: "Concepts",
    description: "Tables, members, views",
    audience: "both",
  },
  {
    id: "reference",
    title: "References",
    description: "Commands, REST, auth",
    audience: "ref",
  },
];

export const docsPages: DocsPage[] = [
  {
    slug: "welcome",
    sectionId: "welcome",
    title: "Welcome",
    description: "Agent-first Talk-to-Build. Tables remain the core data view. One command layer.",
    body: [
      {
        type: "p",
        text: "tabdo is Agent-first Talk-to-Build: describe a system in chat and the agent creates tables, columns, automations, and formulas. Postgres Grid / Board remain the core data display — full filters, kanban, formulas are not reduced. UI, in-app Vercel harness tools, external MCP/Skill, and Bearer agt_ keys all call the same commands.",
      },
      {
        type: "callout",
        tone: "info",
        text: "Public docs need no login. Mutating real data needs a session (human) or Authorization: Bearer agt_… (agent).",
      },
      { type: "h2", text: "Get started" },
      {
        type: "cards",
        items: [
          {
            title: "For AI Agents",
            description: "External agents: MCP + Skill. In-product builders use Vercel harness built-in tools (see Harness).",
            href: "/docs/mcp",
            badge: "Agents",
          },
          {
            title: "For Humans",
            description: "/app opens Talk-to-Build + table. Full Grid / Board / filters stay on each table.",
            href: "/docs/human-quickstart",
            badge: "Humans",
          },
        ],
      },
      { type: "h2", text: "How it works" },
      {
        type: "p",
        text: "Every create / update / move lands in server commands. There is no separate “agent API”. Permissions are org membership — user.kind is human or agent; member.role is the same.",
      },
    ],
  },
  {
    slug: "how-it-works",
    sectionId: "welcome",
    title: "How it works",
    description: "Discover schema → window-query rows → patch cells. Pay attention only to the shared command layer.",
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
│   UI    │  │ In-app Harness tools│  │ External MCP/Skill│  │ agt_ Key │
│ Grid/Bd │  │ (Codex/Claude/Pi)   │  │ (Claude/Cursor…)  │  │          │
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
        text: "For external agents only. Package @tabdo/mcp exposes every command as a snake_case tool (1:1 with in-app harness tools). Tools POST to /api/commands with your agent API key. The product UI does not use MCP — it uses Vercel harness built-in tools.",
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
        text: "For external agents. skills/table-ops/SKILL.md teaches when to use MCP vs HTTP, how to paginate, and that select/person store ids. In-app Talk-to-Build already has harness tools — no Skill install required inside /app.",
      },
      {
        type: "ol",
        items: [
          "Copy or symlink skills/table-ops into your agent skills folder",
          "New in-app agents do not issue API keys; external MCP requires an existing external credential",
          "Prefer MCP tools; fall back to POST /api/commands",
          "Always get_table before writing select / person cells",
        ],
      },
    ],
  },

  {
    slug: "harness",
    sectionId: "agents",
    title: "In-app Harness tools",
    description: "Vercel AI SDK Codex / Claude / Pi with built-in tools — not MCP.",
    body: [
      {
        type: "p",
        text: "Inside tabdo (/app Talk-to-Build and the AI drawer), the assistant uses Vercel AI SDK harnesses. Tools are registered in-process via createTableTools — the same command layer as MCP, but MCP is for external agents only.",
      },
      {
        type: "ul",
        items: [
          "Harness switcher: Codex · Claude · Pi",
          "Built-in tools: list_tables, get_table, query_rows, update_cell, add_row, set_status, …",
          "No Assistant Cloud; no MCP required for in-product chat",
          "External Claude/Cursor/Codex CLI → use MCP + Skill instead",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "Agent-first is the entry narrative. Full grid, kanban, filters, automations, and formulas remain first-class on /app/tables/:id.",
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
        text: "Create an in-app agent with a name, persona, harness and model. Creation returns the agent configuration without an API key. In-app chat uses your signed-in session. Previously issued external credentials remain valid; issuing new external credentials is currently unavailable.",
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
    description: "Sign up, open /app, edit tables and boards like Feishu.",
    body: [
      {
        type: "ol",
        items: [
          "Register at /signup (demo: demo@agrid.app / Demo1234!)",
          "Open /app — Talk-to-Build chat + table list (Agent-first entry)",
          "Open a table for full Grid / Board / filters / formulas (unchanged)",
          "Invite humans (Resend) or create Agents under Members",
          "Automations: /app/tables/:id/automations",
        ],
      },
      {
        type: "callout",
        text: "Every UI mutation still hits the same command layer your agent will use.",
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
    description: "UI · Tools · MCP · API Key share one Command Layer.",
    body: [
      {
        type: "p",
        text: "server/src/commands is the only write implementation. HTTP, in-app harness tools, and external MCP are shells. Table product features (grid, board, filters) stay complete.",
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
        text: "10w+ tables must use keyset cursors. Never OFFSET a full dump.",
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
          "agent_profile — persona, default harness, apiKeyHash",
          "invitation — human invites via Resend",
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
    description: "Better Auth sessions and agent API keys.",
    body: [
      {
        type: "ul",
        items: [
          "Humans: Better Auth email/password cookie session",
          "Agents: Authorization: Bearer agt_…",
          "AUTH_REQUIRED=true → 401 when missing",
        ],
      },
    ],
  },
];

export function getDoc(slug: string) {
  return docsPages.find((p) => p.slug === slug);
}

export function docsNav() {
  return docsSections.map((s) => ({
    ...s,
    pages: docsPages.filter((p) => p.sectionId === s.id),
  }));
}

export function searchDocs(query: string): DocsPage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (page: DocsPage) => {
    let s = 0;
    if (page.title.toLowerCase().includes(q)) s += 10;
    if (page.description.toLowerCase().includes(q)) s += 5;
    if (page.slug.toLowerCase().includes(q)) s += 3;
    for (const b of page.body) {
      if (b.type === "p" || b.type === "h2" || b.type === "h3" || b.type === "callout") {
        if (b.text.toLowerCase().includes(q)) s += 1;
      } else if (b.type === "ul" || b.type === "ol") {
        if (b.items.some((i) => i.toLowerCase().includes(q))) s += 1;
      } else if (b.type === "code") {
        if (b.code.toLowerCase().includes(q)) s += 1;
      } else if (b.type === "table") {
        if (
          b.headers.some((h) => h.toLowerCase().includes(q)) ||
          b.rows.some((r) => r.some((c) => c.toLowerCase().includes(q)))
        )
          s += 1;
      } else if (b.type === "cards") {
        if (
          b.items.some(
            (c) =>
              c.title.toLowerCase().includes(q) ||
              c.description.toLowerCase().includes(q)
          )
        )
          s += 1;
      }
    }
    return s;
  };
  return docsPages
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

/** Markdown-ish index for /docs/llms.txt generators */
export function docsLlmsLines(origin: string = BRAND.url): string[] {
  const lines = ["# tabdo", ""];
  for (const section of docsNav()) {
    lines.push(`## ${section.title}`);
    for (const p of section.pages) {
      lines.push(
        `- [${p.title}](${origin}/docs/${p.slug}.md): ${p.description}`
      );
    }
    lines.push("");
  }
  return lines;
}
