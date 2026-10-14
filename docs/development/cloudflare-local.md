# 本地 Cloudflare 开发

`pnpm dev:cf` 启动 Vite 前端与本地 Wrangler（Workers、Durable Objects、Queues、R2），智能体运行时按需启动 Docker Sandbox。业务数据仍使用 PostgreSQL，不需要额外启动 Node API 或 Redis。

## 准备与启动

需要 Node.js 24、pnpm 9.15.0、运行中的 Docker Engine，以及可连接的 PostgreSQL。首次安装依赖后，在根目录创建 `.env.cf`；已有 `.env` 可继续使用。

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DATABASE
DEEPSEEK_API_KEY=YOUR_KEY
# 切换 DeepSeek 时清空旧提供商配置
OPENROUTER_API_KEY=
PI_API_KEY=
```

```bash
pnpm install
pnpm cf:db:migrate  # 显式更新选中的 PostgreSQL，启动不会自动迁移
pnpm cf:check       # 检查数据库结构、Docker、端口并准备本地配置
pnpm dev:cf
```

默认打开 `http://localhost:5173`。Vite 将 API 请求代理到 Wrangler 的 `8787` 端口；调试端口为 `9231`。已有数据库会保留，脚本不创建或重置数据库。迁移前确认 `DATABASE_URL` 指向预期数据库。

端口被占用时会报错，不会结束已有进程。可在 `.env.cf` 设置 `CF_CLIENT_PORT`、`CF_WORKER_PORT`、`CF_INSPECTOR_PORT`，三者必须不同且为 1–65535 的整数。`CF_GATEWAY_ORIGIN` 默认 `http://host.docker.internal:8787`，会随 Worker 端口调整；自定义地址必须能从容器访问 Worker。

## 配置与模型

优先级为 **启动进程的环境变量 > `.env.cf` > `.env`**，空字符串也会覆盖前一层。Shell 中已经导出的旧 Key 不会被文件中的空值覆盖，需要先 `unset OPENROUTER_API_KEY PI_API_KEY`，或显式以空值启动。

未设置 `PI_API_KEY` 时，`DEEPSEEK_API_KEY` 映射为 Pi 的直接提供商配置，默认 `PI_BASE_URL=https://api.deepseek.com/v1`、`PI_MODEL=deepseek-flash`、`PI_CONTEXT_WINDOW=1048576`（未显式配置时）；可用 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 覆盖。显式 `PI_API_KEY` 优先，此时同时配置 `PI_BASE_URL` 与 `PI_MODEL`。非空 `OPENROUTER_API_KEY` 在原生模型配置中优先于 Pi 直接提供商，使用 DeepSeek 时应清空它。

DeepSeek 模型及窗口依据[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)。默认输出上限保持 16384，可用 `PI_MAX_OUTPUT_TOKENS` 调整。直连 `api.deepseek.com` 使用 `max_tokens`，并显式传 `thinking: { type: "disabled" }`，与当前非推理模式一致；协议依据[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

启动脚本自动设置本地 `APP_URL`、`BETTER_AUTH_URL`。模型 Key 等允许的配置写入私有 `.dev.vars`；值需为可安全引用的单行文本，无法表示时会明确报错。数据库连接只通过本地 Hyperdrive 环境变量交给 Wrangler，不写入生成的 `.dev.vars` 或 Docker 构建配置。

## 状态与运行边界

- `.local/cf/secrets.json` 保存自动生成的认证与集成加密密钥，重启复用；有效的显式配置会覆盖它们。目录权限为 `0700`，新建配置文件为 `0600`。不要提交、分享或随意删除这些文件。
- `.local/cf/state/` 保存 Wrangler 本地状态，包含 R2 文件与 DO 数据；R2 对象位于其 `v3/r2/` 下。清除此目录会丢失本地文件，但不会清除 PostgreSQL 中的文件记录。
- 本地每分钟模拟一次 Cron，驱动定时任务等后台处理；停止开发进程后不再触发。
- 当前产品执行链仅接入 **Pi + local 原生运行模式**。界面中的“本地工作区”指 Sandbox 容器内的工作区，不是宿主机项目目录；容器由任务按需启动。
- `Ctrl+C` 停止本次启动的 Vite/Wrangler 子进程；已有 PostgreSQL 与 Docker Engine 保持运行。

本指南用于本地开发。生产部署、线上凭证和资源配置尚未验收，不能直接视为生产发布步骤。架构边界见[运行时与包边界](../architecture/runtime-boundaries.md)。

## 配置回归测试

```bash
node --test scripts/test/cf-dev.test.mjs
```

测试仅使用临时文件与虚拟凭证，不连接 PostgreSQL、启动 Docker 或占用开发端口。

## 实际产品链路回归

仅在独立 `*_agent_test` 数据库上运行。先在一个终端用本地模型协议测试端点启动实际开发栈（测试会监听 18973，不使用真实模型 Key）：

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/tabdo_agent_test \
CF_CLIENT_PORT=5189 CF_WORKER_PORT=8791 CF_INSPECTOR_PORT=9241 \
OPENROUTER_API_KEY= PI_API_KEY=fixture-not-production \
PI_BASE_URL=http://127.0.0.1:18973/v1 PI_MODEL=fixture-native \
PI_CONTEXT_WINDOW=262144 PI_MAX_OUTPUT_TOKENS=1024 pnpm dev:cf
```

另一个终端执行；两套用例串行运行，避免协议服务端口冲突：

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/tabdo_agent_test \
TABDO_CF_PRODUCT_LIVE=1 TABDO_CF_AUTOMATION_LIVE=1 \
TABDO_CF_FRONTEND_ORIGIN=http://localhost:5189 \
TABDO_CF_WORKER_URL=http://localhost:8791 pnpm test:cloudflare:product
```

覆盖前端代理、认证、原生聊天、工具写入、容器冷续接、R2、取消，以及实际 Queue 数据动作和 Cron 定时任务历史。用例清理自己的 PG 数据与运行；上传的本地 R2 测试对象会输出精确 key，必要时通过 Wrangler 仅删除这些 key。未开启对应变量时用例明确跳过。此回归不等于真实 DeepSeek 或线上 CF 验收。
