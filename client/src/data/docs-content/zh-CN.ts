import type { DocsPage, DocsSection } from "./types";

export const docsSections: DocsSection[] = [
  { id: "welcome", title: "欢迎", description: "tabdo 是什么，如何开始", audience: "both" },
  { id: "agents", title: "智能体接入", description: "MCP、Skill 与产品内工具", audience: "agents" },
  { id: "humans", title: "人类入门", description: "工作区界面与 HTTP API", audience: "humans" },
  { id: "concepts", title: "概念", description: "表格、成员、视图", audience: "both" },
  { id: "reference", title: "参考", description: "命令、REST、鉴权", audience: "ref" },
];

export const docsPages: DocsPage[] = [
  {
    slug: "welcome",
    sectionId: "welcome",
    title: "欢迎",
    description: "对话优先搭建系统；表格仍是核心数据视图；同一套命令层。",
    body: [
      {
        type: "p",
        text: "tabdo 以对话搭建系统：在聊天里描述需求，智能体即可创建表格、字段、自动化与公式。表格与看板仍是主要数据界面——筛选、看板、公式能力不会被削弱。工作区界面、产品内助手工具、外部 MCP/Skill 连接以及智能体 API 密钥，都调用同一套命令层。",
      },
      {
        type: "callout",
        tone: "info",
        text: "公开文档无需登录。修改真实数据需要登录会话（人类）或智能体 API 密钥（Authorization: Bearer agt_…）。",
      },
      { type: "h2", text: "开始使用" },
      {
        type: "cards",
        items: [
          {
            title: "面向智能体",
            description: "外部智能体：MCP + Skill。产品内构建使用内置运行时工具。",
            href: "/docs/mcp",
            badge: "智能体",
          },
          {
            title: "面向人类",
            description: "打开 /app 即可对话建表。每张表保留完整的表格、看板与筛选。",
            href: "/docs/human-quickstart",
            badge: "人类",
          },
        ],
      },
      { type: "h2", text: "工作原理" },
      {
        type: "p",
        text: "每一次创建、更新与移动都经过服务端命令层，没有单独的「智能体 API」。权限按组织成员判定——user.kind 为 human 或 agent；member.role 对两者相同。",
      },
    ],
  },
  {
    slug: "how-it-works",
    sectionId: "welcome",
    title: "工作原理",
    description: "先读结构 → 窗口查询行 → 再补丁单元格。共用命令层。",
    body: [
      {
        type: "ol",
        items: [
          "getTable — 结构与 rowCount（绝不整表倾倒）",
          "queryRows — 带筛选 / 排序 / 看板列的 keyset 窗口",
          "updateCell / setStatus — 带可选 expectedVersion 的补丁",
        ],
      },
      {
        type: "code",
        lang: "text",
        code: `┌─────────┐  ┌─────────────────────┐  ┌─────────────────┐  ┌──────────┐
│   UI    │  │ 产品内运行时工具      │  │ 外部 MCP/Skill   │  │ agt_ 密钥 │
│ 表格/看板│  │ (Codex/Claude/Pi)   │  │ (Claude/Cursor…) │  │          │
└────┬────┘  └──────────┬──────────┘  └────────┬──────────┘  └────┬─────┘
     └──────────────────┴───────────┬──────────┴───────────────────┘
                                    ▼
                           POST /api/commands
                         （表格能力保持完整）`,
      },
    ],
  },
  {
    slug: "mcp",
    sectionId: "agents",
    title: "MCP",
    description: "通过 MCP 将 Claude、Codex、Cursor 或 OpenCode 接到 tabdo。",
    body: [
      {
        type: "p",
        text: "面向外部智能体。@tabdo/mcp 将每条命令暴露为 snake_case 工具（与产品内工具 1:1）。工具携带智能体 API 密钥 POST 到 /api/commands。产品 UI 不走 MCP，而是使用内置运行时工具。",
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
        text: "不要整表加载。智能体查询默认限制 50 行（最大 200）。",
      },
    ],
  },
  {
    slug: "skill",
    sectionId: "agents",
    title: "Skill",
    description: "在 Cursor、Claude Code 等环境安装 tabdo 技能。",
    body: [
      {
        type: "p",
        text: "面向外部智能体。skills/table-ops/SKILL.md 说明何时用 MCP 或 HTTP、如何分页，以及 select/person 存的是 id。产品内对话已有运行时工具——在 /app 内无需再安装 Skill。",
      },
      {
        type: "ol",
        items: [
          "将 skills/table-ops 复制或软链到智能体的 skills 目录",
          "新建产品内智能体不会下发 API 密钥；外部 MCP 需要已有凭证",
          "优先使用 MCP 工具；必要时回退到 POST /api/commands",
          "写入 select / person 单元格前务必先 get_table",
        ],
      },
    ],
  },
  {
    slug: "harness",
    sectionId: "agents",
    title: "产品内运行时工具",
    description: "Codex / Claude / Pi 内置工具 — 不是 MCP。",
    body: [
      {
        type: "p",
        text: "在 tabdo 内（/app 对话与 AI 抽屉），助手使用产品内运行时（Codex、Claude 或 Pi）。工具在进程内注册——与 MCP 共用命令层，但 MCP 仅供外部智能体。",
      },
      {
        type: "ul",
        items: [
          "运行时切换：Codex · Claude · Pi",
          "内置工具：list_tables、get_table、query_rows、update_cell、add_row、set_status …",
          "产品内对话无需独立云助手，也无需 MCP",
          "外部 Claude / Cursor / Codex CLI → 请改用 MCP + Skill",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "对话优先是入口叙事。每张表页上的表格、看板、筛选、自动化与公式仍是一等能力。",
      },
    ],
  },
  {
    slug: "agent-auth",
    sectionId: "agents",
    title: "智能体与鉴权",
    description: "用登录会话创建产品内智能体；无需智能体密钥。",
    body: [
      {
        type: "p",
        text: "用名称、人设、运行时与模型创建产品内智能体。创建结果返回配置，不含 API 密钥。产品内对话使用你的登录会话。既有外部凭证仍然有效；目前暂不支持签发新的外部凭证。",
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
    title: "工作区界面",
    description: "注册、打开 /app，编辑表格与看板。",
    body: [
      {
        type: "ol",
        items: [
          "在 /signup 注册（演示账号：demo@tabdo.ai / Demo1234!）",
          "打开 /app — 对话建表与表格列表",
          "打开某张表，使用完整的表格 / 看板 / 筛选 / 公式",
          "在成员 / 智能体页邀请同事或创建智能体",
          "自动化：/app/tables/:id/automations 或自动化中心",
        ],
      },
      {
        type: "callout",
        text: "界面上的每一次变更，都会打到智能体也会使用的同一套命令层。",
      },
    ],
  },
  {
    slug: "api-quickstart",
    sectionId: "humans",
    title: "HTTP API",
    description: "在自己的代码里调用 POST /api/commands。",
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
        text: "新集成请优先使用 /api/commands。/api/tables 下的 REST 是同一批处理器的薄别名。",
      },
    ],
  },
  {
    slug: "architecture",
    sectionId: "concepts",
    title: "同源架构",
    description: "界面 · 工具 · MCP · API 密钥共用命令层。",
    body: [
      {
        type: "p",
        text: "server/src/commands 是唯一写入实现。HTTP、产品内工具与外部 MCP 都是外壳。表格产品能力（表格、看板、筛选）保持完整。",
      },
      {
        type: "callout",
        text: "权限只检查组织成员关系。user.kind 不会分叉 API。",
      },
    ],
  },
  {
    slug: "tables",
    sectionId: "concepts",
    title: "表格、字段与行",
    description: "面向十万行级的字段类型与 JSONB 单元格。",
    body: [
      {
        type: "table",
        headers: ["类型", "单元格值", "说明"],
        rows: [
          ["text", "string | null", "纯文本"],
          ["number", "number | null", "数值比较 / 筛选"],
          ["select", "optionId | null", "存选项 id，不是标签"],
          ["multi_select", "optionId[]", "id 数组"],
          ["date", "ISO date | null", "日历与输入"],
          ["checkbox", "boolean", "开关"],
          ["person", "userId | null", "人类或智能体"],
          ["formula", "computed", "只读；{列名} 引用"],
        ],
      },
      {
        type: "callout",
        tone: "warn",
        text: "大表必须用 keyset 游标。不要用 OFFSET 整表倾倒。",
      },
    ],
  },
  {
    slug: "members",
    sectionId: "concepts",
    title: "成员：人类与智能体",
    description: "同一套用户 + 成员模型；角色对等。",
    body: [
      {
        type: "ul",
        items: [
          "user — kind = human | agent",
          "member — role = owner | admin | member",
          "agent_profile — 人设、默认运行时、apiKeyHash",
          "invitation — 通过邮件邀请人类",
        ],
      },
    ],
  },
  {
    slug: "views",
    sectionId: "concepts",
    title: "视图、筛选与看板",
    description: "表格、看板、AND/OR 筛选与排序。",
    body: [
      {
        type: "ul",
        items: [
          "筛选下推到 Postgres JSONB",
          "看板列按状态选项窗口加载",
          "拖拽卡片 ≡ setStatus / moveCard",
        ],
      },
    ],
  },
  {
    slug: "commands",
    sectionId: "reference",
    title: "命令 API",
    description: "POST /api/commands — 唯一写入入口。",
    body: [
      {
        type: "table",
        headers: ["command", "用途"],
        rows: [
          ["listTables", "列出工作区表格"],
          ["getTable", "结构 + rowCount"],
          ["queryRows", "Keyset 窗口查询"],
          ["updateCell / updateCells", "补丁单元格"],
          ["addRow / deleteRow", "行生命周期"],
          ["addColumn / deleteColumn / updateColumn", "字段生命周期"],
          ["reorderColumns", "字段顺序"],
          ["setStatus / moveCard", "看板移动"],
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
    title: "REST 别名",
    description: "与命令层相同的处理器。",
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
    title: "鉴权",
    description: "会话与智能体 API 密钥。",
    body: [
      {
        type: "ul",
        items: [
          "人类：邮箱/密码 Cookie 会话",
          "智能体：Authorization: Bearer agt_…",
          "AUTH_REQUIRED=true → 缺失时返回 401",
        ],
      },
    ],
  },
];
