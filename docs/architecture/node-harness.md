# Node + 官方 Harness 架构

部署目标为本地和 Railway，使用相同的 Node/Hono 业务入口、PostgreSQL、Redis/BullMQ 和 Vercel Harness SDK。

```text
浏览器 / API 调用
    → Node Hono API → HarnessAgent / Session → 原生 Harness
               │               │
               │               └→ 官方 host tools → 共享业务命令 → PostgreSQL
               └→ PostgreSQL（认证、业务数据、消息、Run、恢复状态）

数据变更 / 邮件事件 / 定时任务
    → PostgreSQL outbox / due schedules → Redis/BullMQ → Node worker
                                                     → 同一套 Harness 执行
```

## 生命周期

- `HarnessAgent` 是配置对象，可每 Run 新建，不作为持久会话存储。
- `HarnessAgentSession` 是活动原生会话，通过官方 `stop` / `detach` 返回的 opaque resume state 恢复。
- Sandbox 独立管理。任务结束不等于销毁 Sandbox；调用者提供的 Sandbox 由调用者负责停止/恢复/删除。
- PostgreSQL 保存 Run、会话和恢复引用。下次 Run 可重新创建 JS 对象后恢复原生会话，无需永久保留每个 Agent 的 JS 实例。
- 浏览器断开只分离输出；显式停止通过 Run 取消请求处理。已提交工具不会因为停止而回滚或从 UI 历史重放。

## 工具与执行位置

业务工具沿用 `tools: { name: tool({ inputSchema, execute }) }`。权限、当前成员资格、数据库 fence 和事务校验留在 host；SDK 负责原生工具桥接及 UI stream，不新增产品 HTTP MCP 接口。

Pi 是 host-runtime：模型循环在 Node API/worker，本地 bash 在真实目录执行；目录边界不是 OS 隔离。Claude/Codex 是 bridge-backed：原生 runtime 在 Vercel Sandbox 内运行。Pi 的远程工作区模式同样不等于将 Pi loop 移入 Sandbox。

## 包边界与部署

`core` 保存通用契约，`platform-node` 实现通用基础设施和原生 SDK adapters，`backend` 保存显式依赖的业务 services，`agent-runtime` 保存共享执行生命周期，`apps/server` 装配 HTTP/worker 与资源。

本地用 `pnpm dev`。Railway API 和 worker 共用 `Dockerfile.server`，分别启动 `dist/index.js` 与 `dist/queue/main.js`；上传文件使用共用 S3 兼容 bucket。配置见 [本地部署](../local-node.md)和 [Railway 部署](../railway.md)。

官方依据：[HarnessAgent 生命周期与恢复](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)、[HTTP/UI 会话管理](https://ai-sdk.dev/docs/ai-sdk-harnesses/ui)。远程 Sandbox、真实模型和 Railway 上线分别验收，不能以本地 fixture 通过代替。
