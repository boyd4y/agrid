# Automation：快速匹配 + 原子领取 outbox + Redis worker

## 执行链路

```text
API / 人机共用 commands
  → PostgreSQL 事务：修改行 + 快速匹配 trigger/conditions
  → 未命中：只保存行，不产生事件/outbox/Redis job
  → 命中：同事务保存触发快照、规则/动作计划和 pending outbox
  → relay 原子领取一批记录（FOR UPDATE SKIP LOCKED + UPDATE RETURNING）
  → 提交领取，不再持有数据库事务或行锁
  → 投递 Redis/BullMQ automation 队列，按领取凭据确认 published
  → worker 按已保存的计划执行动作，保存进度与结果
```

快速匹配使用刚刚写入的行快照，查询该表启用且未删除的规则。
trigger 和 conditions 都通过才产生执行计划。规则快照在匹配时确定，
队列 job 只携带 eventId、generation 和协议版本，不复制宽行 JSON。
同值更新不产生事件；内部 `skipAutomation` 不触发；外部 API 不能设置该选项。
HTTP 只等待业务事务和快速匹配，不等待 Redis 或动作执行。

当前支持 `row_created`、`field_changed`、`enter_status` 和 `update_field`。
`run_agent` 后台运行时尚未接入，命中后明确记录失败，不模拟成功。
当前只有一条 automation 执行队列，没有额外事件匹配队列或 agent 进程。

## 多实例原子领取

领取同时处理待发送记录和领取后失联的记录：

- pending 且 available_at 已到期。
- publishing 且 claim_until 已到期。

一个 SQL 语句用 CTE + FOR UPDATE SKIP LOCKED 选取记录，立即 UPDATE 为 publishing，
写入随机 claim_token、claim_until 并增加 attempts，RETURNING 返回本实例领取的记录。
选取和标记在同一事务中提交；多个 relay 跳过对方锁定的行，不会共同领取同一批。
两类候选分别使用部分索引和批次上限，避免先扫描整个积压再排序。

领取事务回滚时不会留下已领取状态；领取成功后进程退出，租期到期可重新领取。
每条发送前检查并延长自身租期。确认成功或释放重试必须同时匹配 id、generation、
claim_token 和 publishing 状态，旧实例不能修改后来领取者或人工重放后的状态。
Redis 网络操作发生在事务外，不占着数据库行锁等待网络。

默认每批 25 条，最多 8 路并行发送，租期 30 秒；无重叠轮询，默认每 500ms 一次。
失败释放为 pending，按指数退避延迟再次领取，最长 60 秒。

## 保证范围

业务修改、已匹配的计划和 pending outbox 在同一个 PG 事务提交或回滚。
Redis 暂时不可用不会让已接受的触发无声丢失，也不会阻塞表格保存等待 Redis。

数据库领取是原子的，PostgreSQL 和 Redis 之间不是共同事务：

| 故障位置 | 恢复方式 |
| --- | --- |
| 业务事务提交前退出 | 行变更与 outbox 一起回滚 |
| 提交后、领取前退出 | 其他 relay 领取 pending |
| 领取后、入队前退出 | 租期到期后重新领取 |
| 入队成功、确认前退出 | 可能再次投递，通过固定 jobId 和执行进度去重 |
| 入队明确失败 | 释放领取状态，退避后重试 |

成功入队后的 worker 重启由 BullMQ 恢复。已 published 的任务不在 pending 轮询中；
当前没有重建 Redis 已接受但随后丢失的任务的补偿扫描。Redis 必须使用专用持久化实例。
AOF everysec 仍有最近写入丢失窗口，HA/failover 和备份需要在部署环境验收。

## 动作执行与重试

执行前检查工作区、触发者成员资格、表/行、规则启用状态和列类型。
删除、停用或权限撤销取消尚未完成的动作。
字段写回、公式重算、动作凭据、步骤游标、期望版本在同一个数据库事务中提交。
提交后 worker 崩溃，重试只执行剩余动作；Redis job 清理后，DB 执行进度仍防止重复写回。

瞬时故障使用 BullMQ 指数退避和抖动，默认 5 次尝试；无效配置永久失败。
Redis 行租约和租户并发限制跨实例共享；DB fencing 和版本检查阻止旧执行者写回。
采用最新输入优先：行版本变化会将旧事件标记为 superseded，不保证严格 FIFO。

`POST /api/automation-runs/:id/replay` 在事务中恢复失败运行并重置 outbox 为新 generation，
沿用原执行计划和完成进度。跨租户、资源已更新、规则未启用的重放会被拒绝。
旧 generation 的重复任务和旧领取者不能干扰新的执行。

这些事务保证当前数据库字段动作的幂等性；未来邮件/外部 API 必须单独设计外部幂等键。

## 本地与生产

```bash
docker compose up -d redis
pnpm db:migrate
pnpm dev                 # 自动启动 API + 一个 automation 后台进程，另有 client/MCP
# 已有独立 API 进程时，只补启后台进程：
pnpm dev:queue
pnpm --filter @tabdo/server queue:status
```

生产使用同一镜像、两个入口：

| 进程 | 命令 | PG 连接池起点 |
| --- | --- | --- |
| API | node dist/index.js | DB_POOL_MAX=10 |
| Automation 后台（relay + worker） | node dist/queue/main.js | DB_POOL_MAX=4 |

两个进程可同机运行，不需要各占一台服务器。
多实例共享 PostgreSQL、Redis、QUEUE_PREFIX 和并发配置；增加后台副本时，
relay 在 PG 原子领取不同批次，BullMQ 在 Redis 分配执行任务。

```bash
docker compose -f docker-compose.yml -f docker-compose.workers.yml up -d --build --scale worker=2
```

Compose 中用 QUEUE_DATABASE_URL / QUEUE_REDIS_URL 覆盖容器内部地址。
生产直接传 DATABASE_URL / REDIS_URL，支持 rediss://。开发 Redis 端口默认 6380。

WORKER_CONCURRENCY=8 控制单 worker 并发；QUEUE_GLOBAL_CONCURRENCY=32 控制总并发；
AUTOMATION_TENANT_CONCURRENCY=4 控制工作区执行并发。全体副本配置须一致。
连接池预算包含所有 API/后台副本。SIGTERM 停止领取并等待进行中的投递和动作，
默认 20 秒退出期限。queue:status 显示 outbox 数量/最老年龄和 Redis 队列状态。

从旧的 relay/event/step 三角色实现升级时，先停止新写入并排空旧队列，再停止旧进程，
执行迁移 0007 后启动新 API/后台。禁止新旧队列协议混用。执行历史和动作凭据保留。

## 验证

测试使用独立 *_queue_test 数据库和专用 Redis 前缀，禁止清空用户数据库或共享 Redis。

```bash
DATABASE_URL=postgresql://tableapp:tableapp@127.0.0.1:5432/agrid_queue_test \
REDIS_URL=redis://127.0.0.1:6381 QUEUE_PREFIX=agrid-queue-test \
QUEUE_TEST_REDIS_CONTAINER=agrid-queue-test-redis pnpm --filter @tabdo/server test:queue
```

Redis 停止测试只允许专用 agrid-queue-test-redis 容器及 6381 端口。
覆盖匹配过滤、事务/同值更新、快照、版本保护、动作凭据、fencing、租户隔离、
多实例领取互斥、跳过锁定记录、租期恢复、旧领取者隔离、入队后确认前崩溃、
多个消费者、重试耗尽/人工重放、SIGKILL/SIGTERM 和 Redis 中断/恢复。

多进程压测仅测命令层延迟和字段动作，不代表 HTTP/LLM/生产 HA 容量：

```bash
DATABASE_URL=postgresql://tableapp:tableapp@127.0.0.1:5432/agrid_queue_test \
REDIS_URL=redis://127.0.0.1:6381 QUEUE_PREFIX=agrid-queue-test-load \
LOAD_ROWS=200 pnpm --filter @tabdo/server test:queue:load
```

此前旧链路的压测数字不适用于本次实现，不作为容量承诺。

本次本地验证：15 项真实 PG/Redis 队列测试、10 项 UI 回归、全仓 typecheck/build、
新数据库迁移与已有开发库升级通过。多进程冒烟每组 50 行、2 条规则 × 2 个字段动作，
分别启动 1/2/4/8 个后台副本（每个副本均有 relay 和 worker），各组全部完成，
行版本恰好从 1 变为 5。这是小样本正确性检查，不是生产容量或 HA 验收。
