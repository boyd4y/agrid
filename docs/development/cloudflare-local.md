# 本地 Cloudflare 开发

`pnpm dev:cf` 启动 Vite 前端与本地 Wrangler（Workers、Durable Objects、Queues、R2），智能体运行时按需启动 Docker Sandbox。业务数据仍使用 PostgreSQL，不需要额外启动 Node API 或 Redis。

## 准备与启动

需要 Node.js 24、pnpm 9.15.0、运行中的 Docker Engine，以及可连接的 PostgreSQL。首次安装依赖后，在根目录创建 `.env.cf`；已有 `.env` 可继续使用。

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DATABASE
DEEPSEEK_API_KEY=YOUR_KEY
# 可选：清除不用的旧配置；完整 Pi 直连配置会优先
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

未设置 `PI_API_KEY` 时，`DEEPSEEK_API_KEY` 映射为 Pi 的直接提供商配置，默认 `PI_BASE_URL=https://api.deepseek.com/v1`、`PI_MODEL=deepseek-flash`、`PI_CONTEXT_WINDOW=1048576`（未显式配置时）；可用 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 覆盖。显式 `PI_API_KEY` 优先，此时同时配置 `PI_BASE_URL` 与 `PI_MODEL`。完整的 `PI_API_KEY` + `PI_BASE_URL` 优先于遗留的 `OPENROUTER_API_KEY`，执行、模型元数据和状态接口使用同一选择结果。只有直连配置不完整时才回退 OpenRouter，并使用它的 `OPENROUTER_MODEL`（默认 `openrouter/free`），不会混用直连模型名；切换到 OpenRouter 时需清空直连 Key 或地址。

DeepSeek 模型及窗口依据[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)。默认输出上限保持 16384，可用 `PI_MAX_OUTPUT_TOKENS` 调整。直连 `api.deepseek.com` 使用 `max_tokens`，推理模式遵循原生 Pi SDK 默认值（当前 `medium`）；协议依据[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)。

可通过 `PI_THINKING_LEVEL` 显式配置 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。已知支持推理的模型不配置时使用 SDK 默认 `medium`，也会修正旧平台在原生会话中写入的 `off`；只有显式 `off` 禁用。未知模型保留原生能力判断；实际推理强度由提供商映射。仅模型返回的推理内容会展示并保存，普通文本不会被伪装为推理。参见 [Pi 默认级别](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/defaults.ts)及 [DeepSeek 推理协议](https://api-docs.deepseek.com/guides/thinking_mode/)。

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
CF_DEV_DIRECTORY=.local/cf-product-test \
OPENROUTER_API_KEY= PI_API_KEY=fixture-not-production \
PI_BASE_URL=http://127.0.0.1:18973/v1 PI_MODEL=fixture-native \
PI_THINKING_LEVEL=medium PI_CONTEXT_WINDOW=262144 PI_MAX_OUTPUT_TOKENS=1024 pnpm dev:cf
```

另一个终端执行；三套用例串行运行，避免协议服务端口冲突：

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/tabdo_agent_test \
TABDO_CF_PRODUCT_LIVE=1 TABDO_CF_AUTOMATION_LIVE=1 TABDO_CF_STREAMING_LIVE=1 \
TABDO_CF_FRONTEND_ORIGIN=http://localhost:5189 \
TABDO_CF_WORKER_URL=http://localhost:8791 pnpm test:cloudflare:product
```

覆盖前端代理、认证、原生聊天、工具写入、容器冷续接、R2、取消，以及实际 Queue 数据动作和 Cron 定时任务历史。用例清理自己的 PG 数据与运行；上传的本地 R2 测试对象会输出精确 key，必要时通过 Wrangler 仅删除这些 key。未开启对应变量时用例明确跳过。此回归不等于真实 DeepSeek 或线上 CF 验收。

## 聊天延迟与排查

聊天在 PostgreSQL 接受后直接启动执行 DO，不等待后台 Queue 批次；有限的启动确认由 `waitUntil` 托管。通过授权的 SSE 立即发送连接注释，容器初始化期间也能确认连接。自动化和定时任务仍通过 Queue 投递。

Sandbox 将输出按 50ms / 64 段 / 256KiB 有界批量落库，提交后唤醒订阅 DO；断开浏览器不会取消执行。检查点与释放租约前必须等待输出全部提交。健康的聊天流和空闲对话不定时轮询 `/runs`；重载后的活动运行恢复仍会查询状态。

流式测试输出 JSON trace，分开记录发送到模型、响应头、模型首推理和最终输出延迟。它使用本地模型协议端点，不代表 DeepSeek 实际首 token 或线上性能。Apple Silicon 本地运行的 amd64 容器存在架构模拟成本，不能将本地冷启动时间等同于线上冷启动。

并行启动测试栈时务必配置独立 `CF_DEV_DIRECTORY` 及三个端口；该目录隔离配置、私有密钥、DO 和 R2 状态，不覆盖正在使用的默认 `.local/cf`。

Sandbox 镜像构建时仅预编译项目源码，SDK/npm 包保留原有路径；固定 Node 版本的代码缓存随镜像预热。运行时直接执行 JavaScript，避免每个 Run 重新加载 tsx。此构建发生在 Docker 镜像内，Worker 仍由 Wrangler 打包。

2026-10-15 本机独立 Wrangler + Docker + 测试 PG 的对照记录：同一协议端点下，发送到模型接收从 11.34s 降到 5.30s，前端连接确认从 9.55s 降到 56ms；优化后的模型结束到前端流结束约 408ms。240 个推理/正文分片及数据库内容完整，工具、问答冷恢复、取消、自动化和定时任务回归通过。这是本地架构模拟环境的观测，未与 Vercel 实测对比，也未调用真实 DeepSeek。

切换模型提供商后，旧智能体保存的 `openrouter/free` / `openrouter/auto` 默认别名会在直连 Pi 模式下使用当前 `PI_MODEL`，元数据、运行指令与实际请求保持一致。未配置有效直连默认模型时会在启动前提示配置错误；其他明确指定的模型不会自动替换。新建智能体通过 API 未指定模型时保存 `__harness_default__`，跟随当前提供商默认值。已有会话无需删除；更换配置后按正常对话继续，不自动重放失败轮次。

## 真实文件与命令

执行镜像不再安装 `just-bash` 或 `@ai-sdk/sandbox-just-bash`。Pi 的文件操作使用容器真实文件系统，bash 工具直接启动系统进程；镜像提供 Node、Python 3 和 bash。SDK 的工作区与 HOME 位于每次执行自有的临时目录，快照按稳定逻辑路径保存，再恢复到下一容器的真实目录。SDK 与工具执行过程中不会启动第二个容器或内存 Shell。

产品回归通过原生 bash 调用 Node 写入二进制文件并运行 Python，销毁执行容器后，回答问题并在新容器用 Node 读取同一文件，断言字节一致且平台工具没有重放。业务 API、Queue 和 PostgreSQL 权限边界不变。普通 `pnpm dev` 的 local 执行使用宿主真实进程；需要容器边界时使用 `pnpm dev:cf`，目录本身不构成 OS 隔离。
