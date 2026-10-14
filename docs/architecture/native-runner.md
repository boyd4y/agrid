# 持久原生执行器

本阶段把计算资源启动与产品 Run 分开。通用 `@tabdo/execution` 包提供 Node 子进程、签名 HTTP 控制适配器；产品接受、权限、租约、检查点和输出仍由 PG repository 管理。没有另造模型或工具循环。

## Node 聊天

默认 `NATIVE_EXECUTION_ADAPTER=embedded` 保留现有进程内执行。设置为 `node-process` 后，公共 `/api/chat` 请求、身份和 AI SDK UI SSE 保持一致：

1. 验证当前工作区、固定智能体和输入，创建原生 Run。
2. 提交 `agent_executions` 接受记录，释放提交者租约。
3. 子进程只接收执行 UUID，从 PG 重建当前身份、输入、原生 Session 与工作区。
4. 执行者重新领取 fence，先提交 `accepted → invoking` 再调用官方 SDK。输出按游标持久保存。
5. Node 输出投影按需分页、重新验证凭证。浏览器关闭只关闭订阅；显式取消写入 PG。

启动失败仍保留接受记录。Node 装配每五秒扫描最多八个 `accepted` 任务；跨进程 CAS 防止重复调用。`invoking` 且计算状态不明的任务不会自动重跑。此模式当前接通聊天；自动化/定时的原生动作仍使用嵌入式执行入口，待统一接入接受服务。

```sh
pnpm build
NATIVE_EXECUTION_ADAPTER=node-process pnpm --filter @tabdo/server start
```

迁移 `0026_native_execution_dispatch` 新增私有接受与输出表。部署前执行正常迁移；开发回归只使用隔离测试库。

## 私有 HTTP runner

```sh
INTERNAL_EXECUTION_SECRET='<至少 32 字符的随机密钥>' pnpm --filter @tabdo/server runner:start
```

入口默认端口 3002，子进程默认 PG pool 为 2（`RUNNER_DB_POOL_MAX` 可配置），默认 audience 为 `tabdo-agent-runner`。部署入口通过 `execution/adapters/http` 签名调用 `/executions/start|lookup|terminate`。启动 body 只含 `{id, reference: {executionId}}`；服务从已接受记录解析身份，拒绝任意原生输入。密钥与 DB/模型配置只存在于可信控制进程，脚本运行在独立 Sandbox。

HMAC 验证身份、方法、路径、body 与时效；PG 执行记录提供业务去重。HTTP 返回的启动确认不等于完成；逻辑 attempt settled 也不伪造 OS exit code。资源丢失表示 unknown，不作为重新执行工具的依据。

## Cloudflare 与验证边界

DO 通过实际平台服务读取相同 PG 输出与持久取消，每次回调独立创建/关闭 DB/Auth。workerd 已验证真实 Cookie/API Key、私有会话隔离、成员撤销、输出分页与 DO 重建。完整产品 Worker、Queue/Cron 接受服务、runner 资源部署与远程验收仍待接入。

独立进程回归已验证 Pi 的工具只执行一次、待答进程退出、答案通过签名 HTTP 在新进程继续原 Run，以及重复启动不重放。尚未宣称 Codex/Claude、Cloudflare Containers/E2B 的实际远程生命周期完成。
