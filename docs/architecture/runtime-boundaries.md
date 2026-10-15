# 包与运行时边界

部署使用同一套 Node 代码，支持本地与 Railway。按能力拆包，Tabdo 业务集中在 `apps/server`，不再维护 backend 业务包。

| 位置 | 职责 |
|---|---|
| `packages/core` | 基础服务/错误/摘要、任务时间计算、工作区快照契约 |
| `packages/db` | PostgreSQL 连接池、schema 参数化的 Drizzle 工厂与通用事务类型 |
| `packages/auth` | Better Auth、用户/组织/成员/凭证 schema、会话和 API Key 身份验证与 Key 管理 |
| `packages/queue` | 消息、发布/消费、Redis 连接、延迟与失败重试、并发、租约、优雅关闭及 BullMQ 实现 |
| `packages/storage` | 通用本地文件/S3 字节存储 |
| `packages/agent-runtime` | 官方 Harness 组装、本地/Vercel Sandbox、工作目录及快照恢复 |
| `packages/shared` | 前端、MCP、server 共用的产品协议与校验 |
| `packages/ui` | React 组件、主题及设计 token |
| `apps/server/src/business` | 表格、报告、技能、业务权限、集成、自动化、业务 Run/Session 与数据访问 |
| `apps/server/src/harness` | 带工作区身份/租约/检查点的智能体执行编排 |
| `apps/server` 其他入口 | Hono API、后台 worker、环境配置与依赖组装 |

## 依赖规则

- `core` 不引用 db、auth、Tabdo schema、shared 或应用；任务服务只接收通用资源键和配置。
- `db` 不引用 auth 或业务 schema，由 server 传入完整 schema。
- `auth` 可依赖 core，不引用 server 或产品智能体表。旧智能体凭证通过 server 注入的解析回调兼容。
- queue/storage 独立于产品；agent-runtime 只依赖通用基础与官方 SDK，不导入业务 Run 或 Actor。
- Tabdo 业务组合上述能力。API Key 权限仍与所属用户一致，工具写入仍受成员资格、事务和 fence 保护。
- SQL 表名、字段、索引和约束保持一致；schema 的代码归属变化不要求数据迁移。

## 任务边界

core 提供时间/时区计算；queue 负责真实的队列运行基础设施，包括 Redis 配置转换、发布、Worker 消费与重试、延迟投递、并发租约与续租、在途任务排空和连接关闭。server 通过处理回调接入，生产代码不直接导入 BullMQ/ioredis。环境变量读取、进程信号以及后台业务循环仍由应用入口组装。

自动化触发匹配、事件快照、Agent 任务说明、业务执行收据、outbox 原子提交及补偿查询属于 server。queue 提供至少一次投递，不能代替数据库中的业务幂等性。core/queue 不认识表格、邮件、工作区或特定自动化动作。

聊天与后台任务使用相同官方 Harness 生命周期。本地与 Railway 无平台选择开关，不增加独立部署服务。`pnpm check:architecture` 检查包依赖方向与无业务依赖的基础包。
