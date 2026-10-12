# Agrid · AI-native 多维表（Notion / 飞书风格）

React + Vite + **shadcn/ui** 前端，Hono + Drizzle + PostgreSQL 后端。  
人机能做同一套操作：共享命令层、看板、右侧 AI（Codex / Claude / Pi）。

## 功能

### 营销站与认证
- **首页** `/`、**文档** `/docs`（公开，无需登录）、**博客** `/blog`、**登录** `/login`、**注册** `/signup`
- **Better Auth**（email/password + organization）；会话 cookie 经 Vite 代理到 API
- **Resend** 邀请邮件（无 `RESEND_API_KEY` 时邀请链接打在服务端日志）
- 工作台 `/app` 需登录（`RequireAuth`）

### 表格 / 看板（不回归）
- 7 种列类型、筛选、排序、列设置（改类型 / 选项 / 隐藏 / 重排 / 拖宽）
- 看板按「状态」列拖拽；命令层与 Agent tools 对齐
- 表单控件全部 **shadcn**（Select / Input / Checkbox / Textarea / ColorPicker），无原生 `<select>` / `type="date"` / `type="color"`

### 成员（人 + Agent 同权）
- 员工：邀请邮件加入工作区
- 智能体：人设 + 一次性 `agt_…` API Key，角色与人类相同
- 统一入口：`POST /api/commands`（session 或 `Authorization: Bearer agt_…`）

### AI 聊天
- 右侧助手基于 **assistant-ui** (`@assistant-ui/react`) + **`@assistant-ui/ai-sdk`**（AI SDK v7 / `@ai-sdk/react`）
- `ChatPanel`：`AssistantRuntimeProvider` + `useChatRuntime` + `AssistantChatTransport({ api: "/api/chat" })`
- 请求体携带 `harness` / `model` / `tableId`；服务端表格 tools 不变
- UI 使用 assistant-ui primitives（`ThreadPrimitive` / `ComposerPrimitive` / `MessagePrimitive`）
- 可切换 **Codex / Claude / Pi** + 模型；**无 Assistant Cloud**
- 未配置密钥时走 Mock 规则引擎；`data-table-mutated` / tool 完成会刷新表格

### 设计系统
- Notion 色板（`#37352f` / `#2383e2` / `#e9e9e7`）
- shadcn 组件 + **cva** variants
- **Storybook**：`pnpm --filter client storybook` → http://localhost:6006

## 快速开始

```bash
cd /workspace/feishu-notion-table
cp .env.example .env   # 已有 .env 可跳过
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev               # :5173 前端 + :3001 API
```

### Demo 账号（`pnpm db:seed` / `pnpm db:seed:demo`）

| | |
|--|--|
| email | `demo@agrid.app` |
| password | `Demo1234!` |

幂等：已存在则刷新密码并确保工作区成员关系。

1. 打开 http://localhost:5173/login → 用上面 Demo 账号登录（或自行注册）
2. 进入工作台 → 成员面板邀请同事 / 创建 Agent
3. 表格 / 看板 / 右侧 AI（切换 harness）

## Storybook

```bash
pnpm --filter client storybook
```

## 环境变量

见 [`.env.example`](./.env.example)。要点：

| 变量 | 说明 |
|------|------|
| `BETTER_AUTH_SECRET` | ≥32 字符密钥 |
| `BETTER_AUTH_URL` | API 根，如 `http://localhost:3001` |
| `APP_URL` | 前端，如 `http://localhost:5173` |
| `RESEND_API_KEY` | 邀请邮件；空则 console mock |
| `AUTH_REQUIRED=true` | 强制 `/api/commands` 登录 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `PI_*` | 多 harness |



## 高性能表格（10w+ / 对标飞书）

- **Keyset 游标分页**：`POST /api/tables/:id/rows/query`（`cursor` + `limit`），禁止 `OFFSET` 全表扫描
- **SQL 筛选下推**：过滤器在 Postgres JSONB 上执行，不在内存扫全表
- **索引**：`(table_id, sort_order, id)` + GIN(`cells`)
- **前端虚拟滚动**：`@tanstack/react-virtual`，按可视窗口拉取分页
- **单格 patch**：`PATCH /api/rows/:id` + `expectedVersion` 乐观锁
- **看板按列窗口**：每列独立 `statusColumnId` / `statusValue` 分页
- **Agent tools**：`get_table` 只返 schema；`query_rows` 强制窗口（默认 50、最大 200）

### 大表种子与冒烟

```bash
pnpm db:migrate
pnpm db:seed:large          # 默认 100_000 行；可传数字 pnpm db:seed:large 50000
pnpm db:smoke:perf          # 验证 cursor / filter / kanban window / 单格 patch
```


## 文档 · MCP · Skill（人机同源）

- **公开文档**：http://localhost:5173/docs — 概念、命令层 API、MCP、Skill（Marketing 顶栏「文档」）
- **MCP 包**：[`mcp/`](./mcp) → `@table/mcp`，tools 与 `COMMANDS` 1:1，经 `POST /api/commands`
- **Agent Skill**：[`skills/table-ops/SKILL.md`](./skills/table-ops/SKILL.md)

```bash
# MCP（需 API 在跑；Agent key 可选）
TABLE_API_URL=http://localhost:3001 TABLE_API_KEY=agt_… \
  pnpm --filter @table/mcp start
```

工作台 `/app` **不含博客**；博客仅公开站。

## API 摘要

| Path | 说明 |
|------|------|
| `/api/auth/*` | Better Auth |
| `/api/members` | 成员列表（人+Agent） |
| `/api/members/invite` | 邀请人类 |
| `/api/members/agents` | 创建 Agent（返回一次性 apiKey） |
| `/api/commands` | 人机共用命令 |
| `/api/chat` · `/api/chat/status` | AI 流式聊天 / harness 状态 |
| `/api/tables` … | 表行列 CRUD |
| `POST /api/tables/:id/rows/query` | Keyset 窗口查询（filters/sort/cursor/kanban） |
| `GET /api/tables/:id/rows` | 同上（querystring） |

字段完整性见 [`FIELD_CHECKLIST.md`](./FIELD_CHECKLIST.md)。


## 自动化（飞书 when / if / then）

- 触发：`row_created` · `field_changed` · `enter_status`（进列）
- 条件：复用表格过滤器
- 动作：`update_field`（命令层写回）· `run_agent`（智能体 + 可选写回）
- API：`/api/tables/:id/automations` · `/api/automations/:id` · `/api/tables/:id/automation-runs`
- 命令层：`listAutomations` / `createAutomation` / `updateAutomation` / `deleteAutomation` / `listAutomationRuns`
- UI：表格详情页「自动化」面板
- 写回使用 `skipAutomation`，避免动作再次触发规则
