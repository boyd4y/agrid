# 包与运行时边界

部署使用同一套 Node 代码，支持本地与 Railway。Tabdo 业务集中在 `apps/server`，不维护 backend 包或部署平台切换。Queue / Worker 的拆分过程与验收见 [实施记录](queue-worker-plan.md)。

| 位置 | 职责 |
|---|---|
| `packages/core` | 基础服务/错误/摘要、任务时间计算、工作区快照契约 |
| `packages/db` | PostgreSQL 连接池、schema 参数化的 Drizzle 工厂与通用事务类型；当前仍是薄连接模块，见评审 |
| `packages/auth` | Better Auth、身份 schema、会话/成员校验和 API Key 管理 |
| `packages/queue` | 消息契约、发布/接收/确认、延迟重投、队列检查/统计、Redis 连接和原子租约、BullMQ 锁与 stalled 机制 |
| `packages/worker` | 依赖 queue 的任务执行、重试策略、租约作用域、outbox 流程、恢复调度、轮询、排空及进程退出控制 |
| `packages/storage` | 通用本地文件/S3 字节存储 |
| `packages/agent-runtime` | 官方 Harness 组装、本地/Vercel Sandbox、工作目录及快照恢复 |
| `packages/shared` | 前端、MCP、server 共用的产品协议与校验 |
| `packages/ui` | React 组件、主题及设计 token |
| `apps/server/src/business` | 表格、报告、技能、权限、集成、自动化、业务 Run/Session 与 SQL 存储操作 |
| `apps/server/src/automation/jobs` | 自动化处理器、业务资源键、queue/worker 配置与依赖组装 |
| `apps/server/src/harness` | 带身份/租约/检查点的智能体执行编排 |
| `apps/server/src/queue` | 稳定的后台启动与状态 CLI 入口 |

## 依赖规则

- core 不引用 db、auth、产品 schema、shared 或应用，也不承担 worker 框架。
- db 不引用 auth 或业务 schema，由 server 传入完整 schema。
- auth 可依赖 core，不引用 server 或产品智能体表；旧智能体凭证由 server 注入解析回调。
- worker 必须依赖 queue 的根契约；不导入 queue 的 Redis/BullMQ 实现或驱动依赖。queue 不依赖 worker。
- queue/worker/storage 均不依赖产品协议或应用；agent-runtime 只依赖基础契约与官方 SDK，不导入业务 Run/Actor。
- server 组装具体提供方和业务处理器，不直接导入或声明 BullMQ/ioredis 依赖。
- 配置显式传入包，环境变量只在应用入口读取。SQL 表名、字段、索引和约束保持一致，本轮不需要数据迁移。

## 任务执行边界

worker 调用 queue 消费接口，处理任务并返回完成、暂缓或重试的投递决定；queue 将决定转换为提供方机制。BullMQ Job/Worker 对象不进入 worker/server，投递次数和终态通过公共契约传递。

Redis 原子租约由 queue 提供。worker 获取租约、检查所有权，并在整个处理器（包括业务错误记账）结束后释放。server 仅映射工作区/记录资源键及维护数据库 fence/收据。聊天与后台任务仍调用同一官方 Harness 业务生命周期。

outbox 的 claim、renew、markPublished、markFailed 是 server 提供的存储操作；worker 执行并发发布、退避、清理与排空。恢复候选 SQL、generation/Run 状态判断和补偿写回留在 server；worker 管理消息检查、租约和恢复流程。至少一次投递不能替代业务幂等。

正常工作通过 Redis 控制消息唤醒，定时和 outbox 重试通过延迟消息触发；数据库提交后才发送通知。worker 只在启动时和默认每 15 分钟执行补偿扫描，隔离不同任务及日志回调错误。关闭时停止新扫描，等待当前扫描和消费者结束，再关闭其余资源。Node host 处理 SIGTERM/SIGINT、启动失败和关闭超时；API/worker 仍是同一镜像的两个进程入口。详见 [事件驱动 Worker](event-driven-worker.md)。

`pnpm check:architecture` 检查依赖方向、worker 对 queue 的必需依赖、驱动隔离和无环；职责与行为还需真实队列、事务和进程故障测试验证。
