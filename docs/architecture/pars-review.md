# Pars 核心层调研

日期：2026-10-14。源码审阅基线：[`parsrun/pars@08f3ebd`](https://github.com/parsrun/pars/tree/08f3ebd83706e301a14097b0443e4de032c542e7)。本次只读调研，没有安装 Pars，也没有执行其脚本。以下结论区分源码能力与对 tabdo 的设计判断。

## 值得借鉴的核心

| 实现 | 核对到的设计 | tabdo 的采用方式 |
| --- | --- | --- |
| `core` | 环境访问、错误、日志、通用类型与 Web Crypto 工具 | 小而独立的 edge-friendly kernel；平台资源通过显式上下文注入 |
| `server` | Hono app factory 将数据库、配置和日志注入请求上下文 | 保留 Hono，以同一 app factory 组装 Node 与 Workers 入口 |
| `service` | service definition 与 RPC transport 分离；embedded transport 直接执行，HTTP / binding transport 发送相同 envelope | 平台只依赖 service contract；运行位置和调用方式属于部署扩展 |
| `queue` | producer 与 batch processor 分离；Cloudflare consumer 逐消息 ack / retry | 使用统一 delivery envelope，投递确认与业务效果去重分离 |
| `storage` | 一个存储接口承载 S3 和 R2 | 文件元信息、权限在平台；对象字节由扩展包负责 |
| `realtime` | SSE 与 DO WebSocket 的 channel 接口 | 保持同一用户协议，服务端使用可替换事件通道 |
| 包导出 | ESM、subpath exports、适配器入口 | Node-only SDK 与 Cloudflare binding 不从核心 barrel 导出 |

这套思路的价值是稳定调用边界和显式组装，不是用运行时名字代替资源能力，也不是为每个普通函数增加 RPC。

## 不能直接作为 tabdo 运行框架的部分

1. **没有 Harness / Sandbox 执行适配。** 当前仓库没有匹配 tabdo Run、原生 Session、问题续接和执行环境生命周期的实现。不能把 SaaS provider abstraction 当作已实现的智能体运行平台。
2. **队列能力不对称。** `QueueAdapterType` 是 memory / cloudflare / qstash，没有 BullMQ。`receive`、`consume` 等为可选方法。Cloudflare `send` 只使用 delay，未实现公共选项中的 deduplication / priority；生成的客户端 ID 不是供应商返回的消息 ID。tabdo 应将数据库稳定事件 ID 放进消息体，不依赖供应商去重或伪造投递 ID。
3. **运行时判断不能作为组装依据。** `detectRuntime()` 以存在 caches 且不存在 process 判断 Cloudflare；当前 Workers Node compatibility 已提供 process，不能照搬。部署入口明确选择扩展包，并在启动时验证 binding / 能力。
4. **环境注入不能共享可变全局。** `setEdgeEnv()` 合并模块级对象。tabdo 使用不可变应用配置和请求作用域资源，不在并发请求间写全局 principal / binding。
5. **Realtime 不是身份边界。** DO 适配器从 URL 读取 userId；上层必须验证身份与订阅权限。tabdo 始终由 Better Auth / 用户 Key 解析实际身份，不能信任 URL 中的用户或工作区。
6. **通用数据库适配不能抹掉事务语义。** tabdo 依赖 PostgreSQL 行锁、租约 fence、关联约束和数据写入与 outbox 的同事务提交；不能仅为通用接口切换到 HTTP-only 查询或非等价数据库。

这些是对已读源码的范围判断，不是对 Pars 全部功能或生产稳定性的结论。

## 决策

借鉴其 **core → service contracts → extension providers → deployment composition** 的分层，自有包只实现 tabdo 实际需要的边界。保留 Better Auth、Zod、Hono、Drizzle/PostgreSQL、assistant-ui 和官方 HarnessAgent，不引入 Pars auth，不重写原生模型/工具循环，不将平台业务拆成无需求的微服务。

具体架构、配置和实施验收见[双部署模式架构](dual-deployment.md)。不直接复制 Pars 源码；若后续复制 MIT 代码，必须保留对应版权和许可。

## 源码依据

- [core runtime](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/core/src/runtime.ts)
- [core env](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/core/src/env.ts)
- [server app factory](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/server/src/app.ts)
- [embedded service transport](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/service/src/rpc/transports/embedded.ts)
- [queue types](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/queue/src/types.ts)
- [Cloudflare queue adapter](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/queue/src/adapters/cloudflare.ts)
- [DO realtime adapter](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/realtime/src/adapters/durable-objects.ts)
- [R2 storage adapter](https://github.com/parsrun/pars/blob/08f3ebd83706e301a14097b0443e4de032c542e7/packages/storage/src/adapters/r2.ts)
