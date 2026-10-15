# 包与运行时边界

部署只使用 Node，支持本地和 Railway；执行架构见 [Node + Harness](node-harness.md)。

| 包 | 职责 |
|---|---|
| `core` | 通用 queue、storage、execution 契约，无业务或运行时依赖 |
| `platform-node` | PostgreSQL 以外的通用 Node 实现：BullMQ、S3/本地文件、本地执行/Vercel Sandbox；参数显式传入 |
| `backend` | PostgreSQL/Drizzle、Better Auth、命令、权限、Run/Session、业务 services；不引用运行时包或全局 env |
| `agent-runtime` | 部署无关的官方 Harness 执行生命周期，通过显式 ports 调用宿主实现 |
| `apps/server` | Hono、资源组装、薄业务 facade、官方 Harness 组装与 Run 协调、队列入口 |
| `apps/client` | React/Vite/assistant-ui，通过既有 HTTP/UI stream 使用同一平台 |

Vercel Harness SDK 负责原生工具桥接、流式事件与原生会话恢复。Pi 的 agent loop 在 Node host；本地文件和 bash 使用真实目录/进程，不使用 JustBash。Claude/Codex 的原生 runtime 在官方 Sandbox bridge 内执行。部署环境不会要求前端选择另一套协议。

`pnpm check:architecture` 检查核心无产品依赖、services 显式依赖，以及运行时包隔离。普通业务热更新不需要构建自定义 Agent 容器镜像。
