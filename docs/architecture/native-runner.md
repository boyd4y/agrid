# 持久原生执行器

本文记录现有原生 Node 执行实现，继续服务双部署目标。Cloudflare 路线由 Workers/DO 协调，在 Sandbox 内执行完整原生 Harness；Worker 不直接加载 Node SDK，也不要求额外常驻 Node HTTP 服务。最新包边界见[运行时与包边界](runtime-boundaries.md)。本地 Wrangler + Docker 的完整产品链路已验证；远程部署另验。

本阶段把计算资源启动与产品 Run 分开。通用 `@tabdo/platform-node/execution/*` 能力提供 Node 子进程、签名 HTTP 控制适配器；产品接受、权限、租约、检查点和输出仍由 PG repository 管理。没有另造模型或工具循环。

## Node 聊天

默认 `NATIVE_EXECUTION_ADAPTER=embedded` 保留现有进程内执行。设置为 `node-process` 后，公共 `/api/chat` 请求、身份和 AI SDK UI SSE 保持一致：

1. 验证当前工作区、固定智能体和输入，创建原生 Run。
2. 提交 `agent_executions` 接受记录，释放提交者租约。
3. 子进程只接收执行 UUID，从 PG 重建当前身份、输入、原生 Session 与工作区。
4. 执行者重新领取 fence，先提交 `accepted → invoking` 再调用官方 SDK。输出按游标持久保存。
5. Node 输出投影按需分页、重新验证凭证。浏览器关闭只关闭订阅；显式取消写入 PG。

启动失败仍保留接受记录。Node 装配每五秒扫描最多八个 `accepted` 任务；跨进程 CAS 防止重复调用。`invoking` 且计算状态不明的任务不会自动重跑。自动化/定时也提交相同持久接受记录；Node 装配可等待已有原生执行入口，CF 只提交有限派发。

```sh
pnpm build
NATIVE_EXECUTION_ADAPTER=node-process pnpm --filter @tabdo/server start
```

迁移 `0026_native_execution_dispatch` 新增私有接受与输出表。部署前执行正常迁移；开发回归只使用隔离测试库。

## Node 模式可选私有 HTTP 控制（现有实现）

下面的入口是已实现的可选 Node 控制服务，不是 Cloudflare 目标拓扑中的必需部署。Cloudflare 将使用 DO/Sandbox 生命周期控制；可复用其通用协议与持久接受语义，不要求启动本节服务。

```sh
INTERNAL_EXECUTION_SECRET='<至少 32 字符的随机密钥>' pnpm --filter @tabdo/server runner:start
```

入口默认端口 3002，子进程默认 PG pool 为 2（`RUNNER_DB_POOL_MAX` 可配置），默认 audience 为 `tabdo-agent-runner`。部署入口通过 `execution/adapters/http` 签名调用 `/executions/start|lookup|terminate`。启动 body 只含 `{id, reference: {executionId}}`；服务从已接受记录解析身份，拒绝任意原生输入。密钥与 DB/模型配置只存在于可信控制进程，脚本运行在独立 Sandbox。

HMAC 验证身份、方法、路径、body 与时效；PG 执行记录提供业务去重。HTTP 返回的启动确认不等于完成；逻辑 attempt settled 也不伪造 OS exit code。资源丢失表示 unknown，不作为重新执行工具的依据。

## Cloudflare 与验证边界

`apps/cloudflare/src/index.ts` 装配正式 Hono/Queue/Cron 入口，共用 `backend`。`ProductSessionObject` 投影 PG 输出并处理取消；`ProductExecutionObject` 只持计算资源元数据，启动单次 Sandbox 程序。原生 SDK、Pi adapter 和 JustBash 工作区在 `sandbox/runtime/` 中运行，通过受限 HTTP gateway 执行平台工具及提交检查点；其业务权限仍由 PG 当前成员与 fence 决定。

迁移 `0027_execution_gateway` 增加执行能力与工具调用凭据。工具效果和结果记录同事务提交；重复相同调用读取结果，更换输入或旧 fence 拒绝。执行状态不明时不盲目重放。提问由官方 SDK 校验，答案在新容器中续接同一个 Run。

本地使用 `pnpm dev:cf`，见[本地开发指南](../development/cloudflare-local.md)。真实 Vite → Worker → Queues/DO → Docker/Pi 验收覆盖工具、问答冷恢复、R2、取消和定时历史；数据变更自动化也经过实际 Queue。测试使用隔离 PostgreSQL 与本地模型 HTTP 服务，没有调用生产模型。

当前 CF 产品执行只支持 Pi/local；Codex/Claude 在 Node 保留已有实现，在 CF 尚未接入。线上 Hyperdrive、Cloudflare Container、真实 DeepSeek、其他远程 Sandbox 均未计入本轮通过。
