# tabdo · AI 原生工作空间

品牌名：**tabdo**。主品牌域名：[tabdo.ai](https://tabdo.ai)；备用域名：`tabdo.dev`。

**让想法，动起来。** 把想做的事告诉 tabdo，让 AI 帮你整理信息、安排步骤并动手完成。你随时可以查看和调整。名称对应 Table → Do → AI；以灵活数据为基础，面向个人和小团队。完整品牌方向见 [品牌定位](docs/brand/positioning.md)。

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
- 智能体：名称 + 人设 + Skill + Harness + 模型 + 运行环境；创建不生成 API Key，站内对话使用登录会话。已有外部接入凭证继续有效。
- 统一入口：`POST /api/commands`（session 或 `Authorization: Bearer agt_…`）

### AI 聊天
- 右侧助手基于 **assistant-ui** (`@assistant-ui/react`) + **`@assistant-ui/ai-sdk`**（AI SDK v7 / `@ai-sdk/react`）
- `ChatPanel`：`useRemoteThreadListRuntime` + 自有数据库 adapter + `useChatRuntime` + `AssistantChatTransport`
- 请求携带 `agentId`、会话 `id` 和当前页面 `context`；Harness / model 由服务端智能体配置决定
- UI 使用 assistant-ui primitives（`ThreadPrimitive` / `ComposerPrimitive` / `MessagePrimitive`）
- 表格支持 Lucide 图标选择及工作区置顶（在工作区内共享），图标和置顶状态存入数据库；侧栏“我的表格”默认折叠，置顶表格直接出现在工作区菜单下。
- AI 页面使用可收起的会话列表及默认打开的右侧工作面板（通过表格 / 表单 / 自动化菜单按需打开 Tab，每种类型最多一个），工作面板关闭后可通过聊天工具栏右侧按钮重新展开，切换 Tab 或收起面板保留编辑草稿。成功的数据写入按表格合并通知，表格 / 表单 / 自动化共享刷新信号，并提供手动刷新；后台 Worker 或其他客户端的变更可通过手动刷新获取。聊天与输入框最大宽度 768px；其他页面使用右下角浮动助手，顶部统一为智能体选择、历史对话、新对话和收起操作；输入框固定在底部，收起后保留草稿
- AI 首页是工作区上下文，不默认绑定第一张表。表格详情与该表的自动化页面才注入经过工作区校验的表格上下文
- 会话、消息、分支关系和工具结果存储在 PostgreSQL；按登录账号及工作区隔离，支持刷新恢复和删除。**无 Assistant Cloud**
- 推荐卡仅在空对话中显示，输入时保留。字段和自动化使用页面内编辑，保持侧边 AI 可见
- `/api/chat` 使用官方 `HarnessAgent`，本地 Pi 或远程 Sandbox；未配置凭证时明确报错，不生成模拟回复。仅成功修改数据的工具会触发数据刷新。

聊天与原生执行持久化需要执行全部迁移，包括 `0018_native_agent_sessions` 和 `0019_agent_runs`，本地执行 `pnpm db:migrate`。
聊天集成测试使用独立、已迁移且名称以 `_agent_test` 结尾的数据库：`DATABASE_URL=postgresql://.../tabdo_agent_test pnpm --filter @tabdo/server test:chat`。
全部测试已归档到各包平级 `test/`，统一命令、独立数据库和持续浏览器回归见 [测试说明](docs/testing.md)。

聊天发送启动独立 Run，使用保存的原生 Session，而不是重放 UI 历史。默认 16 步，在 SDK 的暂停边界结束后可发送“继续执行”恢复未完成 turn；Pi 可能在边界前预取下一次模型请求。等待限制见 `.env.example` 的 `AI_CHAT_*`：每步 90 秒、首个输出 45 秒、流中断 30 秒、整轮 5 分钟，通过官方生命周期/流事件驱动的 AbortSignal 控制。超时或无文字结束会追加说明；停止不会撤销已提交的数据修改。Run 状态、阶段事件、消息与原生检查点持久化；同一对话的重复发送和并发执行会被拒绝。进程崩溃导致检查点缺失时要求核对数据并新建对话，不自动重试工具。

本地只需要配置 Pi/OpenRouter 提供商；Codex 和 Claude Code 需要 Vercel Sandbox 及对应原生模型凭证。详见 [Agent 运行说明](docs/agent-runtime.md)。plan/goal 已持久化并可在聊天 header 查看；AGENTS.md 从人设内部生成。完整 Run 管理界面仍在迭代，远程 Sandbox 尚待真实凭证验收。

### 设计系统
- Notion 色板（`#37352f` / `#2383e2` / `#e9e9e7`）
- shadcn 组件 + **cva** variants
- **Storybook**：`pnpm --filter @tabdo/client storybook` → http://localhost:6006

## 快速开始

```bash
cd /workspace/tabdo
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
| email | `demo@tabdo.ai` |
| password | `Demo1234!` |

幂等：已存在则刷新密码并确保工作区成员关系。

1. 打开 http://localhost:5173/login → 用上面 Demo 账号登录（或自行注册）
2. 进入工作台 → 成员面板邀请同事 / 创建 Agent
3. 表格 / 看板 / 右侧 AI（切换 harness）

## Storybook

```bash
pnpm --filter @tabdo/client storybook
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
- **MCP 包**：[`mcp/`](./mcp) → `@tabdo/mcp`，tools 与 `COMMANDS` 1:1，经 `POST /api/commands`
- **Agent Skill**：[`skills/table-ops/SKILL.md`](./skills/table-ops/SKILL.md)

```bash
# MCP（需 API 在跑；Agent key 可选）
TABDO_API_URL=http://localhost:3001 TABDO_API_KEY=agt_… \
  pnpm --filter @tabdo/mcp start
```

工作台 `/app` **不含博客**；博客仅公开站。

## API 摘要

| Path | 说明 |
|------|------|
| `/api/auth/*` | Better Auth |
| `/api/members` | 成员列表（人+Agent） |
| `/api/members/invite` | 邀请人类 |
| `/api/members/agents` | 创建智能体（不生成 API Key） |
| `/api/commands` | 人机共用命令 |
| `/api/chat` · `/api/chat/status` | AI 流式聊天 / harness 状态 |
| `/api/threads` · `/api/threads/:id/messages` | 私有会话列表、历史与生命周期管理 |
| `/api/tables` … | 表行列 CRUD |
| `POST /api/tables/:id/rows/query` | Keyset 窗口查询（filters/sort/cursor/kanban） |
| `GET /api/tables/:id/rows` | 同上（querystring） |

字段完整性见 [`FIELD_CHECKLIST.md`](./FIELD_CHECKLIST.md)。


## 自动化（飞书 when / if / then）

- 触发：`row_created` · `field_changed` · `enter_status`（进列）
- 条件：复用表格过滤器
- 动作：`update_field`（事务写回 + 动作凭据）；`run_agent` 后台运行时暂未接入，会明确记录未执行。
- API：`/api/tables/:id/automations` · `/api/automations/:id` · `/api/tables/:id/automation-runs`
- 命令层：`listAutomations` / `createAutomation` / `updateAutomation` / `deleteAutomation` / `listAutomationRuns`
- UI：表格详情页「自动化」面板
- 行变更事务内快速匹配启用的 trigger 和 conditions，只有命中的执行计划写入 outbox；relay 用 `FOR UPDATE SKIP LOCKED` 原子领取后投递 Redis/BullMQ。
- 多实例跳过已锁定记录；领取租期到期可恢复，确认必须匹配领取凭据。Redis 暂时不可用不阻塞业务保存；动作写回不再次触发规则。
- `skipAutomation` 仅内部命令允许，外部 `/api/commands` 不能设置。
- 同一行采用版本保护：输入已更新时取消旧事件，运行记录显示「输入已更新」。
- 失败重放：`POST /api/automation-runs/:id/replay`，沿用动作完成凭据。

```bash
# 专用 Redis 默认 6380，避开本机其他项目的 6379
# 使用已有 PostgreSQL 时无需重新创建它
docker compose up -d redis
pnpm db:migrate
pnpm dev                 # API + 一个后台 automation 进程、client、MCP
# 仅已有 API 进程需要补启 worker 时：
pnpm dev:queue
pnpm --filter @tabdo/server queue:status
```

默认生产部署也可以只使用 API + 一个后台 automation 进程，共用 `Dockerfile.server` 镜像：
API 启动 `node dist/index.js`，后台启动 `node dist/queue/main.js`。
单个 `automation` 队列和后台入口，同时运行 relay 与动作消费者；增加后台副本时，数据库原子分配投递批次，Redis 分配执行任务。
Compose 样例见 `docker-compose.workers.yml`；生产 Redis 使用专用持久化 HA 服务，
不能与可驱逐 key 的缓存共用。部署与验证范围见 [AUTOMATION-RELIABILITY.md](./AUTOMATION-RELIABILITY.md)。

关联与汇总已实现，详见 [TABLE-RELATIONS.md](./TABLE-RELATIONS.md)。新增迁移 `0012_table_relations`，本地执行 `pnpm db:migrate`。

Workspace 包统一为 `@tabdo/client`、`@tabdo/server`、`@tabdo/shared`、`@tabdo/mcp`；根包名称为 `tabdo`。
