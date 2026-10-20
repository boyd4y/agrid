# Railway 部署

部署使用 Node 24、PostgreSQL、Redis/BullMQ 和官方 Vercel Harness SDK，与本地共用业务代码及聊天协议。

## 服务

| 服务 | 配置 | 职责 |
|---|---|---|
| api | `.railway/railway.ts` 中的 `api` | 同源前端、Hono API 和聊天；发布前运行数据库迁移 |
| worker | `.railway/railway.ts` 中的 `worker` | outbox relay、BullMQ 消费、定时任务和后台 Agent |
| PostgreSQL | Railway 或已有实例 | 业务、认证、消息、Run、执行租约与原生恢复信息 |
| Redis | Railway 或已有实例 | BullMQ；启用持久化并配置 `noeviction` |

生产发布以人工确认并推送的 `vX.Y.Z` 版本 tag 为入口，由专用发布工作流构建一个镜像并将相同的不可变 digest 部署给 API 和 worker。新流程启用后，普通 `master` push、合并和 CI 不会触发该工作流的生产部署；但在管理员一次性停用 Railway 现有的 `master` 自动部署前，master 更新仍可能直接触发生产部署。远端启用完成前不要推送生产 tag。首次配置和失败恢复说明见[生产发布指南](releases.md)。

正式工作流在发现 pending migration 时，先建立并验证 Neon snapshot，再用目标镜像运行一次数据库迁移；没有 pending migration 时不创建 snapshot，也不运行 migrator。只有在 [`migrations.json`](../scripts/release/migrations.json) 中登记真实 SQL SHA-256、向后兼容且不需 writer drain 的迁移才可自动执行；其它迁移须单独规划。生产不执行 seed。`.railway/railway.ts` 不管理镜像 source/build，且将 `preDeploy` 留空；这不会自动改变 Railway 现有服务设置，管理员仍需按[生产发布指南](releases.md)一次性停用 master 触发、image auto updates，并清理旧 preDeploy hook。根目录的 `railway.api.json`、`railway.worker.json` 保留作旧配置参考。工作目录由镜像设置为 `/app/apps/server`。

## 共同环境变量

两个服务配置相同的 `DATABASE_URL`、`REDIS_URL`、`QUEUE_PREFIX`、`BETTER_AUTH_SECRET`（随机 32+ 字符）、`BETTER_AUTH_URL`、`APP_URL`。URL 指向公开 API 域名，镜像同时提供 SPA。Railway 注入 `PORT`，镜像监听 `0.0.0.0`。API 直接执行聊天，worker 执行自动化与定时任务，两者使用同一官方 Harness 实现。

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

## 后台唤醒与 Neon

正常事件在 PostgreSQL 事务提交后通过 Redis 唤醒 worker；定时任务及 outbox 重试使用 Redis 延迟消息，不再每 500ms 扫描数据库。保持 worker 常驻以消费消息。

`AUTOMATION_RECOVERY_INTERVAL_MS=900000` 控制启动后的兜底扫描间隔，默认 15 分钟；旧 `AUTOMATION_RELAY_POLL_MS` 不再生效。更短的兜底间隔会减少故障补偿延迟，但可能阻止 Neon 闲置休眠。事务提交后进程崩溃或 Redis 通知丢失时，启动恢复/下一次补偿扫描仍会处理已持久化事件。频繁的业务任务、多个副本及其他客户端仍会消耗数据库计算额度。

## 验收

检查 `/api/health`、登录、文件上传下载、推理和工具流、连续对话、显式取消、数据自动化和定时历史。集成测试仅使用隔离 `_agent_test` / `_queue_test` 数据库及专用 Redis；不指向线上数据。线上冒烟仅使用自身新建的临时资源并在结束后清理；一次发布检查不能代替真实模型或远程 Sandbox 专项验收。

## 表格 API

迁移 `0030_unified_api_keys` 合并既有 Key 并保留原凭证，迁移后在设置的「API Key」中为每张表格独立勾选 CRUD 操作；`/api/graphql` 和附件路由共用现有 API 服务，限流使用既有 Redis。`BETTER_AUTH_URL` 应为公开 HTTPS 域名，以便附件生成正确地址。SDK 随仓库构建，npm/CDN 发布是独立操作。接入方式见 [表格 API 与 SDK](api/site-api.md)。

## HTML 站点

迁移 `0031_sites` 增加站点、不可变版本和短期预览。前端入口为 `/app/sites`；公开内容通过 `/s/:id/` 访问，发布资产写入上述 S3 bucket。保存版本不会直接发布。预览和公开文档带浏览器隔离策略，不可读取后台身份或存储。无需额外的站点进程或容器；可选 `SITE_PUBLIC_ORIGIN` 应实际路由到同一 API 服务，未配置时沿用 `BETTER_AUTH_URL` 的源。操作与边界见 [Site 工作流](site-workflow.md)。

API和worker配置相同的 `SITE_SDK_URL`，作为这套部署唯一的浏览器SDK来源。海外默认使用固定版本jsDelivr地址；国内另部署一套时配置其CDN地址，无需用户切换。先独立发布对应npm版本并确认链接可用，再启用引用该版本的站点；应用部署不会自动执行npm发布。历史站点文件保留已保存的引用。

参考：[Railway 配置](https://docs.railway.com/config-as-code)、[Dockerfile](https://docs.railway.com/builds/dockerfiles)、[官方 Harness 会话](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)。
