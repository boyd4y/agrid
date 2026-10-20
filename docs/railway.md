# Railway 部署

生产 API 与 worker 由 Railway 的 GitHub 集成部署。服务连接 `boyd4y/agrid` 的 `master` 分支，启用自动部署和 Wait for CI/checkSuites，并用仓库根目录的 `Dockerfile.server` 构建。Railway 环境变量和生产秘密保存在 Railway；本地开发使用 `.env.development` 和隔离资源。

## 分支与发布

`feature` 分支合并到 `develop` 后运行日常 CI，不触发生产部署。人工确认发布后，将 `develop` 中准备好的更改合并到 `master`；GitHub Actions 对 `master` 运行 CI，Railway 在关联检查通过后拉取分支、构建并自动部署。普通开发代理不得直接推送 `master`，发布确认由人工完成。无需版本 tag、手工部署命令、源码上传或自定义部署 API 编排。详见[生产发布指南](releases.md)。

## 服务

| 服务 | 启动命令 | 用途 |
|---|---|---|
| API | `node dist/index.js` | 同源前端、Hono API 和聊天；在 `preDeploy` 检查并按需执行数据库迁移 |
| worker | `node dist/queue/main.js` | outbox relay、BullMQ 消费、定时任务和后台 Agent；在 `preDeploy` 只读等待数据库迁移完成 |
| Redis | Railway Redis | BullMQ 与队列唤醒；启用持久化并配置 `noeviction` |
| PostgreSQL | Neon | 业务、认证、消息、Run 和执行租约数据 |

API 与 worker 是独立 Railway 服务。GitHub push 会分别触发部署，不承诺 API 先于 worker 完成；不能通过服务间的变量引用来保证排序。worker 的只读 `preDeploy` 等待检查负责在数据库迁移完成前阻止新 worker 启动。API `preDeploy` 命令为 `node /app/scripts/release/predeploy.mjs`，worker 只读等待命令为 `node /app/scripts/release/predeploy.mjs --wait`；超时设置均为 1200 秒，worker 最多等待约 18 分钟。配置见 `.railway/railway.ts`。

## 数据库迁移

API `preDeploy` 使用现有 migration plan 校验待执行项。没有 pending migration 时，不创建 snapshot，也不运行 migrator。有 pending migration 时，必须先通过兼容性审批和 SQL hash 校验，再创建 Neon snapshot 并确认恢复点可读；随后调用项目现有 migrator，并复查 migration ledger。任何审批、备份、迁移或读回失败都应使 API 部署失败。流程不会自动回滚数据库，也不会删除旧 snapshot 腾出配额。

worker 的 `preDeploy` 仅仅读取 migration 状态并在有待迁移内容时等待 API 完成，不具备备份或迁移权限，不应配置 Neon 管理密钥。迁移必须兼容旧 writer，因为 API/worker 的现有实例可能仍在运行。

## 环境变量与存储

API 与 worker 使用一致的运行时配置：`DATABASE_URL`、`DATABASE_URL_UNPOOLED`、`REDIS_URL`、`QUEUE_PREFIX`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`APP_URL` 和集成密钥。`BETTER_AUTH_URL`、`APP_URL` 指向公开 API 域名。Railway 注入 `PORT`，应用监听 `0.0.0.0`。生产运行环境设置 `NODE_ENV=production`、`TABDO_ENV=production`、`AUTH_REQUIRED=true` 与 `QUEUE_PREFIX=tabdo-production`。

生产 API 需要创建 Neon snapshot 时，`NEON_API_KEY`、`NEON_PROJECT_ID`、`NEON_BRANCH_ID` 以及 `RELEASE_RAILWAY_PROJECT_ID`、`RELEASE_RAILWAY_ENVIRONMENT_ID`、`RELEASE_RAILWAY_API_SERVICE_ID` 仅存放于 Railway API 服务变量中；worker 无需 Neon 管理密钥，GitHub Actions 不接收生产 Railway、数据库或 Neon 管理凭证。

上传文件使用 S3 兼容 bucket：设置 `FILE_STORAGE_DRIVER=s3` 及 `.env.example` 中的 endpoint、region、bucket 和凭证。API/worker 共用 bucket；不能假定 Railway 服务共享本地磁盘。AgentMail 使用相同的 `INTEGRATION_ENCRYPTION_KEY`。

本地开发使用 `.env.development`。开发和测试不得连接生产数据库；集成测试使用隔离的 `_agent_test` / `_queue_test` 数据库与专用 Redis。

## 智能体

先使用 Pi + DeepSeek：

```dotenv
PI_API_KEY=...
PI_BASE_URL=https://api.deepseek.com/v1
PI_MODEL=deepseek-flash
```

API 和 worker 配置一致。Pi 的 agent loop 在各自 Node host；运行环境无需 Docker socket、自定义 Agent 镜像或单独 MCP 服务。镜像内提供 bash、Python 和 Git，原生工作区及日志通过既有快照和 opaque resume state 恢复。

使用 Claude/Codex 或 Pi 远程工作区时，配置 `VERCEL_TOKEN`、`VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID`（或官方支持的 OIDC），并给对应原生提供商配置模型密钥。官方 Sandbox adapter 完成创建、bootstrap 模板及 resume lookup；无需自行发布 Agent Docker 镜像。Claude/Codex 的原生 runtime 在 Sandbox 内；Pi 的 agent loop 仍在 Node host。

## 后台唤醒与 Neon

正常事件在 PostgreSQL 事务提交后通过 Redis 唤醒 worker；定时任务及 outbox 重试使用 Redis 延迟消息。保持 worker 常驻以消费消息。

`AUTOMATION_RECOVERY_INTERVAL_MS=900000` 控制启动后的兜底扫描间隔，默认 15 分钟；旧 `AUTOMATION_RELAY_POLL_MS` 不再生效。更短的兜底间隔会减少故障补偿延迟，但可能阻止 Neon 闲置休眠。事务提交后进程崩溃或 Redis 通知丢失时，启动恢复/下一次补偿扫描仍会处理已持久化事件。频繁的业务任务、多个副本及其他客户端仍会消耗数据库计算额度。

## 验收

检查 `/api/health`、登录、文件上传下载、推理和工具流、连续对话、显式取消、数据自动化和定时历史。集成测试仅使用隔离 `_agent_test` / `_queue_test` 数据库及专用 Redis；不指向线上数据。生产端到端部署和迁移流程仍待实测；实测完成前不得将其描述为已通过验收。

## 表格 API

迁移 `0030_unified_api_keys` 合并既有 Key 并保留原凭证，迁移后在设置的「API Key」中为每张表格独立勾选 CRUD 操作；`/api/graphql` 和附件路由共用现有 API 服务，限流使用既有 Redis。`BETTER_AUTH_URL` 应为公开 HTTPS 域名，以便附件生成正确地址。SDK 随仓库构建，npm/CDN 发布是独立操作。接入方式见 [表格 API 与 SDK](api/site-api.md)。

## HTML 站点

迁移 `0031_sites` 增加站点、不可变版本和短期预览。前端入口为 `/app/sites`；公开内容通过 `/s/:id/` 访问，发布资产写入上述 S3 bucket。保存版本不会直接发布。预览和公开文档带浏览器隔离策略，不可读取后台身份或存储。无需额外的站点进程或容器；可选 `SITE_PUBLIC_ORIGIN` 应实际路由到同一 API 服务，未配置时沿用 `BETTER_AUTH_URL` 的源。操作与边界见 [Site 工作流](site-workflow.md)。

API和worker配置相同的 `SITE_SDK_URL`，作为这套部署唯一的浏览器SDK来源。海外默认使用固定版本jsDelivr地址；国内另部署一套时配置其CDN地址，无需用户切换。先独立发布对应npm版本并确认链接可用，再启用引用该版本的站点；应用部署不会自动执行npm发布。

参考：[Railway GitHub 自动部署](https://docs.railway.com/deployments/github-autodeploys)、[Railway Dockerfile 构建](https://docs.railway.com/builds/dockerfiles)、[Railway 配置](https://docs.railway.com/config-as-code)、[Dockerfile](https://docs.railway.com/builds/dockerfiles)。
