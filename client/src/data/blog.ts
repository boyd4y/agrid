import type { BlogCoverId } from "@/components/illustrations/BlogCover";

export type BlogCategory =
  | "Product"
  | "Engineering"
  | "AI agents"
  | "Design"
  | "How-to";

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  author: string;
  category: BlogCategory;
  tags: string[];
  body: string[];
  /** Notion-style cover illustration id */
  cover: BlogCoverId;
  /** Public OG / social image path */
  coverImage: string;
};

export const blogCategories: BlogCategory[] = [
  "Product",
  "Engineering",
  "AI agents",
  "Design",
  "How-to",
];

export const blogPosts: BlogPost[] = [
  {
    slug: "same-command-layer",
    title: "Same Command Layer: Why Agents Should Not Get a Second API",
    excerpt:
      "UI clicks, MCP tools, and Bearer keys all POST the same commands. One permission model, one conflict story.",
    date: "2026-10-08",
    author: "Agrid Team",
    category: "AI agents",
    tags: ["API", "MCP", "architecture"],
    cover: "same-command-layer",
    coverImage: "/blog-covers/same-command-layer.svg",
    body: [
      "Most “AI-native” products bolt a chatbot onto a human UI. The agent then scrapes DOM, invents REST shapes, or gets a narrow sidecar API that drifts.",
      "Agrid does the opposite. Every mutation — updateCell, addRow, setStatus — is a named command. The React table, assistant-ui tools, @table/mcp, and agt_ keys are shells over that list.",
      "That means an agent cannot do something a human cannot authorize, and a human cannot do something the agent cannot call. Docs for both audiences describe one surface.",
    ],
  },
  {
    slug: "ai-native-tables",
    title: "AI-Native Tables: Anything You Click, an Agent Can Call",
    excerpt:
      "Feishu-style grid and board, with tools that mirror every cell edit and card move.",
    date: "2026-10-01",
    author: "Agrid Team",
    category: "Product",
    tags: ["AI", "product"],
    cover: "ai-native-tables",
    coverImage: "/blog-covers/ai-native-tables.svg",
    body: [
      "Traditional multidimensional tables lock interaction into mouse clicks. Agents that want to change a status are stuck with screenshots or brittle scripts.",
      "We folded creates, updates, filters, and card moves into shared commands. Humans edit cells through the command layer; Codex / Claude / Pi call the same tools.",
      "Permissions align too: employees and agents are org members with the same roles. Agents get a persona + one-time agt_ key; humans use Better Auth sessions.",
    ],
  },
  {
    slug: "100k-rows-keyset",
    title: "100k Rows Without OFFSET: Keyset Windows for Grid and Agents",
    excerpt:
      "Virtualized UI and cursor pagination so neither the browser nor an agent ever loads the whole table.",
    date: "2026-09-28",
    author: "Agrid Team",
    category: "Engineering",
    tags: ["performance", "Postgres"],
    cover: "100k-rows-keyset",
    coverImage: "/blog-covers/100k-rows-keyset.svg",
    body: [
      "Feishu-grade grids assume large single tables. OFFSET 50000 is a tax; dumping JSONB cells into the client is worse.",
      "Agrid’s getTable returns schema + rowCount only. Rows always arrive through queryRows with a keyset cursor, filters pushed into Postgres, and agent limits capped at 200.",
      "The board view window-loads each status column independently — same API the agent must use when it “moves a card.”",
    ],
  },
  {
    slug: "notion-style-workspace",
    title: "Notion-Style Workspace Without the Toy Table",
    excerpt:
      "Quiet typography, soft illustrations, and a left rail that stays out of the way of the grid.",
    date: "2026-09-20",
    author: "Agrid Team",
    category: "Design",
    tags: ["design", "Notion"],
    cover: "notion-style-workspace",
    coverImage: "/blog-covers/notion-style-workspace.svg",
    body: [
      "Visual language follows Notion: warm paper backgrounds, #37352f body text, light borders, almost no drop shadows.",
      "Marketing, docs, blog, and the signed-in shell share one illustration skill and shadcn tokens so dark mode does not invent a second brand.",
      "The app chrome is a slim left rail; AI sits in a right drawer so the table keeps the width it needs.",
    ],
  },
  {
    slug: "multi-harness-chat",
    title: "Multi-Harness Chat: Codex, Claude, and Pi on One Tool Surface",
    excerpt:
      "Switch models without rewriting tools. Mock mode still exercises the same command contracts.",
    date: "2026-09-05",
    author: "Agrid Team",
    category: "Engineering",
    tags: ["Vercel AI SDK", "harness"],
    cover: "multi-harness-chat",
    coverImage: "/blog-covers/multi-harness-chat.svg",
    body: [
      "Vercel AI SDK streamText picks OpenAI-compatible or Anthropic providers from the harness toggle. Pi plugs in as another compatible endpoint.",
      "Without keys, a deterministic mock still runs tools so demos never depend on a vendor outage.",
      "assistant-ui renders the thread; the tool list stays identical across harnesses.",
    ],
  },
  {
    slug: "mcp-five-minutes",
    title: "How-to: Wire Agrid MCP in Five Minutes",
    excerpt:
      "Create an agent member, drop the key into Cursor, list tables, and move a board card.",
    date: "2026-09-01",
    author: "Agrid Team",
    category: "How-to",
    tags: ["MCP", "Cursor"],
    cover: "mcp-five-minutes",
    coverImage: "/blog-covers/mcp-five-minutes.svg",
    body: [
      "In Members, create an Agent and copy the one-time agt_ key.",
      "Add the @table/mcp server to your MCP config with TABLE_API_URL and TABLE_API_KEY.",
      "Ask the agent: list tables → get_table → query_rows → set_status. That is the whole happy path.",
    ],
  },
];

export function getPost(slug: string) {
  return blogPosts.find((p) => p.slug === slug);
}

export function postsByCategory(category: BlogCategory | "All") {
  if (category === "All") return blogPosts;
  return blogPosts.filter((p) => p.category === category);
}
