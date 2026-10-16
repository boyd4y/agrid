# 本地 Node 部署

使用构建后的前端、Node API 和独立后台 worker。前端和 API 同源，默认入口为 `http://localhost:3301`，无需 Vite 开发代理。PostgreSQL 和 Redis 使用本机 Compose 服务，与 `pnpm dev` 共用 `.env.development` 的开发数据；线上 Neon 和 Railway 配置单独存放，不会被读取。

要求 Node 22.18+（推荐 Node 24）、pnpm 9.15.0、运行中的 Docker。

```sh
pnpm install --frozen-lockfile
pnpm local:config
pnpm local:infra
pnpm local:setup
pnpm local:start
```

`local:config` 创建权限为 0600 的 `.env.development`，生成认证密钥和集成加密密钥；已有文件保持不变。默认数据库 `tableapp`，端口 5432；Redis 6380；日常开发入口 `pnpm dev` 为前端 5173、API 3001。连接必须是本机地址，开发模式禁止远程存储。

`local:start` 用相同开发数据运行构建后的应用，单独固定入口为 `http://localhost:3301`，不会覆盖开发配置中的 URL。根目录 `.env` 不再作为应用配置使用。线上用 Railway 环境变量或 `.env.production`，仅由显式线上命令加载，见根 README。

`local:setup` 构建应用、应用全部迁移，并幂等建立演示账号与工作区。登录账号见根 README 的 Demo 账号；仅用于本地体验。`local:start` 启动生产构建的 API 和 worker，任一进程失败会停止另一个；Ctrl+C 会等待它们退出，数据库及 Redis 保留。

另一个终端可以运行实际 HTTP/worker 流程验证：

```sh
pnpm local:smoke
```

该检查登录、选择工作区、创建临时表格与自动化、触发真实 outbox/Redis/worker 写回，再验证乐观更新、查询及删除。它仅接受回环地址，只清理自己创建的表格。

Node 独有的 `CLIENT_DIST_PATH` 指向已构建前端，未设置时仍按原有 API-only 方式启动。SPA 页面支持直接打开及刷新；未知 API 和缺失静态资源保持 404，HTML 不缓存。`local:start` 自动设置该路径。

## 智能体与验收范围

在 `.env.development` 配置 `OPENROUTER_API_KEY`，或 `PI_API_KEY`、`PI_BASE_URL` 和 `PI_MODEL`，即可使用官方 Pi Harness；本地 agent loop 在 Node host，bash 使用真实宿主进程和目录，不需要额外 Agent Docker 镜像。Codex/Claude 和远程 Sandbox 仍要求对应提供商及 Vercel 配置。配置变更后重启 `local:start`。平台未配置模型时明确报错，不生成模拟回复。

本地回归使用真实官方 Harness/Pi、临时本地模型协议服务，覆盖工具副作用、历史持久化、原生提问续接、Node API 与后台 worker；这些检查不能替代真实提供商验收。

集成测试使用另建且名称以 `_agent_test` 结尾的数据库；队列故障测试还需要 `_queue_test` 数据库和专用 Redis。不要将测试指向开发数据库 `tableapp`。完整命令与隔离约定见 [测试说明](testing.md)。

停止本地基础服务（保留卷和数据）：

```sh
docker compose --env-file .env.development -f docker-compose.yml stop
```
