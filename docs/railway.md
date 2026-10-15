# Railway 部署

部署使用 Node 24、PostgreSQL、Redis/BullMQ 和官方 Vercel Harness SDK，与本地共用业务代码及聊天协议。

## 服务

| 服务 | 配置 | 职责 |
|---|---|---|
| api | `/railway.api.json` | 同源前端、Hono API 和聊天；发布前运行数据库迁移 |
| worker | `/railway.worker.json` | outbox relay、BullMQ 消费、定时任务和后台 Agent |
| PostgreSQL | Railway 或已有实例 | 业务、认证、消息、Run、执行租约与原生恢复信息 |
| Redis | Railway 或已有实例 | BullMQ；启用持久化并配置 `noeviction` |

API 和 worker 都从仓库根目录构建 `Dockerfile.server`。在各 service 的 Settings → Config as Code 指定对应配置文件。工作目录已由镜像设置为 `/app/apps/server`。先让 API 迁移和健康检查通过，再启动 worker；生产不执行 seed。

## 共同环境变量

两个服务配置相同的 `DATABASE_URL`、`REDIS_URL`、`QUEUE_PREFIX`、`BETTER_AUTH_SECRET`（随机 32+ 字符）、`BETTER_AUTH_URL`、`APP_URL`。URL 指向公开 API 域名，镜像同时提供 SPA。Railway 注入 `PORT`，镜像监听 `0.0.0.0`。默认 `NATIVE_EXECUTION_ADAPTER=embedded`，不额外部署 runner。

上传文件使用标准 S3 兼容 bucket：设置 `FILE_STORAGE_DRIVER=s3` 和 `.env.example` 中的 endpoint、region、bucket、凭证。API/worker 共用 bucket，不能假定两个 Railway 服务共享本地磁盘。AgentMail 使用相同的 `INTEGRATION_ENCRYPTION_KEY`。

## 智能体

先使用 Pi + DeepSeek：

```dotenv
PI_API_KEY=...
PI_BASE_URL=https://api.deepseek.com/v1
PI_MODEL=deepseek-flash
```

API 和 worker 配置一致。Pi 的 agent loop 在各自 Node host；本地运行环境无需 Docker socket、自定义 Agent 镜像或单独 MCP 服务。镜像内提供 bash、Python 和 Git，原生工作区及日志通过既有快照和 opaque resume state 恢复。

使用 Claude/Codex 或 Pi 远程工作区时，配置 `VERCEL_TOKEN`、`VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID`（或官方支持的 OIDC），并给对应原生提供商配置模型密钥。官方 Sandbox adapter 完成创建、bootstrap 模板及 resume lookup；无需自行发布 Agent Docker 镜像。Claude/Codex 的原生 runtime 在 Sandbox 内；Pi 的 agent loop 仍在 Node host。

## 验收

检查 `/api/health`、登录、文件上传下载、推理和工具流、连续对话、显式取消、数据自动化和定时历史。集成测试仅使用隔离 `_agent_test` / `_queue_test` 数据库及专用 Redis；不指向线上数据。当前未声称已部署 Railway 或完成真实模型/远程 Sandbox 验收。

参考：[Railway 配置](https://docs.railway.com/config-as-code)、[Dockerfile](https://docs.railway.com/builds/dockerfiles)、[官方 Harness 会话](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)。
