# Queue / Worker 拆分计划

状态：已完成并验收。此计划替代此前“把所有后台运行机制归入 queue”及“在 core 中增加 worker 模块”的方案。

## 目标与依赖方向

保留本地 / Railway、Node、PostgreSQL 和 Redis。平台用户不感知包结构调整，不改变消息标识、业务事务和恢复语义。

```text
apps/server：业务处理器、数据访问、环境配置和启动入口
    ├── packages/worker：完整后台任务执行框架
    │       └── packages/queue：消息传输与 BullMQ / Redis 实现
    └── packages/core：基础服务
```

worker 必须依赖 queue，通过队列能力消费和执行任务，不是独立于队列的循环工具。queue 不反向依赖 worker；二者均不依赖 server、产品 schema、AutomationDelivery 或 agent-runtime。worker 如需时钟/ID 等现有基础服务，可依赖 core；不为凑依赖另造基础接口。

## 职责边界

| 位置 | 拥有的职责 |
|---|---|
| `packages/queue` | 消息及投递契约；发布、接收、确认、延迟重投和状态查询；Redis 连接；BullMQ 锁、stalled 检测等提供方机制；关闭自身连接。 |
| `packages/worker` | 处理器执行与分发；执行并发和重试策略；资源租约的获取/续租/释放编排；outbox 投递循环；补偿扫描调度；错误隔离、启停、排空和关闭超时。 |
| `packages/core` | 保持既有基础服务、错误、摘要、时间计算等职责，不新增独立的 worker 运行框架。 |
| `apps/server` | 读取配置、组装任务；自动化消息校验、规则和动作执行；事件/Run/fence/收据判断；业务 SQL、outbox 原子提交和补偿更新；调用既有智能体执行服务。 |

执行策略与底层机制分开：worker 决定何时重试、永久失败或暂缓，queue 将决定转换成 BullMQ 的具体操作；BullMQ Worker 类仍由 queue 的实现持有。Redis 原子租约操作留在 queue 的 Redis 能力中，worker 管理任务执行期间的租约，server 仅映射业务资源键并维护数据库 fence。

outbox 的 claim、renew、markPublished、markFailed 等存储操作由 server 显式传入；worker 负责并发发布、退避、错误清理和循环。补偿同理：worker 调度扫描和执行恢复流程，server 判断哪些业务事件可以安全恢复。业务幂等性由数据库事务和收据保障，不宣称队列 exactly-once。

## 文件迁移清单

| 当前文件 | 计划调整 |
|---|---|
| `packages/queue/src/bullmq.ts` | 保留驱动与锁/投递机制；消费执行策略和服务级排空编排迁入 worker。 |
| `packages/queue/src/lease.ts` | 保留 Redis 原子租约机制；worker 封装执行期间的租约管理。 |
| `apps/server/src/queue/main.ts` | 循环、停止与超时控制迁入 worker；原路径保留薄启动入口，维持脚本和部署命令。 |
| `apps/server/src/queue/config.ts` | 环境变量和业务参数保留 server；通用参数校验/defaults 归所属能力，避免重复声明。 |
| `apps/server/src/queue/workers.ts` | 通用执行/租约/失败编排迁入 worker；业务处理器归 `src/automation/jobs/`。 |
| `apps/server/src/queue/lease.ts` | 连接和资源生命周期由 queue/worker 持有；业务资源键映射归 `src/automation/jobs/`。 |
| `apps/server/src/queue/reconcile.ts` | 队列存在性查询与重连由 queue 提供，扫描与恢复流程由 worker 管理；业务候选查询和补偿 SQL 留在 server。 |
| `apps/server/src/queue/status.ts` | 通用队列统计通过 queue 接口获取；outbox SQL 和 CLI 输出留在 server。 |
| `apps/server/src/business/automation/outbox.ts` | SQL 存储操作保留，发布流程、并发和退避迁入 worker。 |
| `apps/server/src/queue/queues.ts`、`relay.ts` | 用 queue/worker 组装自动化任务；业务配置集中到 `src/automation/jobs/`，删除无必要的转发层。 |

只按实际能力划模块，不复制一套 BullMQ API，不新增平台切换、通用 CRUD、任务插件系统或独立部署服务。API 与后台 worker 仍使用同一镜像的两个进程入口。

## 实施顺序与状态

- [x] 检查现有 queue/server 代码，确认剩余通用运行逻辑。
- [x] 明确 queue 与依赖它的 worker 两个包，以及业务存储操作的边界。
- [x] **第一步：契约。** 整理消息、投递结果、失败分类、处理器和存储回调；先定 queue / worker 的依赖接口，再迁移实现。
- [x] **第二步：queue。** 收敛 BullMQ/Redis 机制，提供消息消费及检查/统计接口，避免向 worker/server 暴露驱动对象和异常。
- [x] **第三步：worker。** 抽取现有执行、租约、outbox、循环、恢复调度和进程生命周期代码，形成真实可运行的执行框架。
- [x] **第四步：server。** 迁移业务处理器和存储操作到 `automation/jobs`，将启动入口收薄；更新开发监听、工作区依赖、Docker 和构建脚本。
- [x] **第五步：验收。** 完成下述检查，更新实际架构文档，再提交并推送。

## 验收要求

- queue/worker 使用报表、邮件等无 Tabdo 依赖的任务验证；worker 测试实际通过 queue 消费，不只 mock 一个轮询函数。
- 验证瞬时重试、永久失败、延迟不消耗失败次数、并发上限、租约丢失、关闭排空、重复关闭和后台错误隔离。
- 验证 outbox 有界并发、发布失败补偿、同一 delivery ID、过期/被替换 claim 不覆盖新状态。
- 保留 PostgreSQL/Redis 隔离队列回归：多 Worker、缺失消息恢复、重试耗尽、SIGKILL 恢复、SIGTERM 排空和业务效果不重复。
- 架构检查禁止 worker/server 直接导入 BullMQ/ioredis，禁止 queue/worker 导入产品协议和应用；同步检查 package.json 依赖。
- 完成类型检查、全量测试、构建、Docker 构建与启动检查；不将本地结果写成 Railway 或真实模型验收。

本轮不调整 db/auth/storage/agent-runtime 边界，不增加数据库迁移，不修改 Harness 协议和产品交互。

## 本轮验收结果

- `pnpm check:architecture`：通过；worker 必需依赖 queue，二者无产品依赖，worker/server 不直接依赖驱动。
- `pnpm typecheck`、`pnpm typecheck:test`、`pnpm build`：通过；开发监听、工作区锁文件与 Docker 已包含 worker 包。
- 配置隔离 PG 和专用 Redis 后的完整 `pnpm test`：239 项通过、0 失败、0 跳过，包含 9 项 worker 测试及真实队列任务。
- 隔离 `_queue_test` 的应用队列故障回归：17 项通过；会主动停止专用 Redis 的断网项未启用，1 项跳过。
- `--conditions=development` 的源码 worker 入口：连接隔离 PG/Redis 启动成功，SIGTERM 排空并退出 0。
- `Dockerfile.server` 生产镜像构建通过；临时 API/worker 两容器完成 HTTP 登录、创建表/自动化、outbox 投递、Redis 消费、真实写回、乐观更新和删除；私有接口鉴权与 SPA 深链通过，后台 SIGTERM 退出 0。
- 临时数据库、容器和本轮产品 smoke 的 Redis 前缀已清理。未部署 Railway，未调用真实模型或远程 Sandbox。

实现入口见 [worker 包](../../packages/worker/README.md)、[queue 包](../../packages/queue/README.md)和 [当前包边界](runtime-boundaries.md)。
