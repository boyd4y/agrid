# 事件自动化与智能体定时任务

自动化的新建来源仅提供表格和邮件，使用“来源 → 触发 → 条件 → 动作”。第一步内联显示来源卡片与空状态，固定内容区域和底部按钮间距，切换来源不改变面板高度。Webhooks 的新建来源入口已撤下，已有规则与接收接口保留兼容。

智能体定时任务位于一级菜单“定时任务”：用一个表单设置名称、智能体、任务描述和时间，不展示事件条件或数据动作编排。列表显示智能体、频率、时区与任务描述；创建、编辑、取消和删除均使用定时任务文案与路由。底层复用现有持久调度和原生 Harness 执行，不引入另一套 agent loop。运行详情继续使用右侧 Sheet。

## 来源

| 来源 | 配置 | 事件上下文 |
| --- | --- | --- |
| 表格 | 实际 `tableId`；新增记录、字段变化、进入状态 | `row.id`、`row.cells.<columnId>`、`cells`、`before/after/changedColumnIds`（变更事件） |
| Webhook | 集成页创建的通用端点 `endpointId` | `payload`：接收的真实 JSON |
| AgentMail | 已连接且注册收信的 `connectionId + inboxId` | `message.subject/text/html/senders/receivedAt` 等规范字段 |
| 定时 | 五段 cron 与 IANA `timeZone` | `scheduledFor`、`dispatchedAt`、`timeZone`、`delayed` |

表格条件使用真实字段类型控件，外部条件使用安全字段路径与同一过滤操作符。缺失邮件正文先持久入队，再由 worker 补取官方消息；完整条件在动作前复核，不把未加载正文误判为条件失败。未满足条件的候选运行标为 skipped，没有数据动作。

保存时拒绝缺少比较值的条件；`0` 和 `false` 都是有效比较值，空值判断应使用“为空/不为空”。历史未填完整的条件或已删除的条件字段不会被忽略并放宽成无条件触发。空数字、空日期不参与大小比较。“进入状态”支持单选与多选：只有新加入目标选项时触发，保持该选项或调整其他选项不会重复触发。

## 动作与绑定

数据动作调用现有命令层，覆盖22种真实记录、字段、关联及对应批量修改。原有 `update_field` 保持兼容。表格字段校验、公式/汇总只读、双向关联、文件归属、单多文件与版本检查均复用普通命令。

输入可为 JSON 字面量，也可引用事件或前一步真实结果：

```json
{
  "type": "command",
  "command": "addRow",
  "input": {
    "tableId": "真实目标表UUID",
    "cells": { "真实标题字段UUID": { "$event": "message.subject" } }
  }
}
```

新增后的下一步用 `{ "$step": { "index": 0, "path": "result.id" } }` 引用真实记录ID；批量结果例如 `result.rowIds.0`。不能引用未来步骤、继承属性或不存在字段，不执行 JavaScript，引用保留实际值类型并由命令 schema 再校验。组织、执行身份与防循环标记由服务器提供，外部 payload 不可覆盖。

智能体动作只选实际智能体与一段任务描述，提示词可以写 `请整理这封邮件：{{event.message.subject}}`。后台复用普通聊天的 Harness SDK、模型、人设、工具、Skill 与原生会话；不再配置虚构 resultValue 或预设“AI结果”。真实输出位于该步骤的 `text`，下一数据动作可用 `$step` 引用 `text`。API、AI 工具与 MCP 使用同一来源/动作 schema。

每个 native 动作关联一条真实私有对话。Harness 实际提问时，Sheet显示待答，打开 `/app?thread=<id>` 在普通对话回答；原生完成后 worker 自动执行后续动作。已经完成的原生输入不重发，工具不因 BullMQ重复投递而再次执行。原生错误、取消、未知结果如实展示，不注入平台暂停口令、计划或目标。

智能体与 MCP 的 `list_automations` 省略 `tableId` 时列出当前工作区全部来源，支持 `offset/limit` 分页（每页最多100条）；`list_automation_runs` 可以直接用 `automationId` 检查邮件、Webhook或定时规则的实际运行，不要求表格ID。显式 `tableId` 只查询该表格，传入不属于它的规则会报错；不因对话绑定表格而隐式排除其他来源。两者均使用服务器当前工作区校验，不能跨工作区查询。

## 可靠性

- 每个数据库动作、receipt和步骤游标在同一个事务提交，失败全回滚；重试从未完成步骤开始。
- Webhook持久接收、匹配、运行与outbox在同一事务提交后ACK。Redis或模型不可用不影响已确认投递的保留。
- 表格事件保留触发记录的版本保护；外部事件根据真实目标命令进行租户/类型/版本检查。被本动作修改或删除的记录不被伪装成用户并发更新。
- 自动化数据命令沿用内部 `skipAutomation` 防止无限相互触发；它不是用户可设置参数。原生智能体实际调用平台工具按普通工具规则产生真实数据变更。
- 规则停用/删除、创建者离开工作区会停止后续执行。旧规则迁移不凭空指定管理员，真实编辑保存时记录执行者。
- 智能体首次启动前同样检查触发行存在与版本；已关联的原生运行对账沿用其真实结果，避免把智能体自己修改的记录误判为旧事件。关联会话和准备结束后的执行接受事务均复核规则启用状态。
- 普通数据事务可保证效果与receipt一起保存；外部原生工具或远端副作用在进程崩溃边界仍需核对，不能承诺跨系统恰好一次。

停用规则阻止后续启动和后续动作，不等同于立即中断已经开始的模型/工具调用；已运行的会话需使用其停止操作。数据动作通过内部 `skipAutomation` 防循环，但原生智能体工具仍会产生普通表格事件，目前没有跨规则调用链的循环检测或深度上限。

## 定时行为

数据库保存下一次执行时间，worker计算到期实例并落入同一outbox。API不依赖浏览器时钟，也不在每个进程里另起无持久定时器。cron-parser处理IANA时区与夏令时。界面不提供执行时间预览；小时、分钟与时区使用共享 Select，不调用浏览器原生时间弹层或 datalist。

同规则版本与计划时刻只接收一个实例，多个worker不会重复调度。停用删除调度游标；修改规则重新计算下一时刻。停机恢复把积压合并为一次已到期触发，`delayed`说明延迟，随后按当前时间计算下一次，不重放每个错过的分钟。

五段cron当前最小粒度为分钟，暂不支持秒级计划、跨账户权限、自动重跑已执行原生任务或精确计费配额。

## 部署与验收

需要正常执行迁移0023，并运行现有queue进程（开发 `pnpm --filter @tabdo/server queue:dev`，生产 `queue:start`）以及Redis。本地Pi只需要所选模型的凭证；本地开发不要求Vercel凭证。只有选择远程sandbox才要求对应配置。[集成部署](integrations.md)说明加密密钥和公网Webhook地址。

测试使用隔离 `tabdo_agent_test` 与本地真实协议/model fixtures，没有调用用户邮箱、付费模型、S3或用户数据库。生产AgentMail连接和远程Sandbox需配置自己的真实凭证再验收；不能把本地协议测试说成已经收取用户邮件。

原生接口依据：[HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)、[Harness Skills](https://ai-sdk.dev/docs/ai-sdk-harnesses/skills)。调度依据：[cron-parser](https://github.com/harrisiirak/cron-parser)。

## 定时任务工作台与会话隔离

定时任务在 `/app/schedules` 中使用左侧任务导航、右侧运行卡片布局。新建与编辑在右侧表单中完成；运行卡片显示触发时间、状态、当时的任务描述与最新回复摘要。选择运行后，在 `/app/schedules/:id/runs/:threadId` 中打开同一聊天会话，可继续发送消息、处理原生问题与停止/恢复。

迁移 `0025_scheduled_sessions.sql` 在 `chat_threads` 增加 `kind`（`chat` / `scheduled_task`）和 `scheduled_task_id`，并用数据库检查约束绑定类型与任务 ID。历史定时运行按真实动作映射补齐类型，不复制消息或原生状态。普通 `/threads` 列表在 SQL 层仅查询 `chat`，任务会话的分页与读取保持创建者账户和工作区隔离。消息、run、checkpoint 和 Harness session 仍复用现有聊天链路；继续任务运行不会变成普通对话，也不能切换到其他智能体。

邮件动作支持 `send_email` / `reply_email`，可用于表格、Webhook、邮件和定时来源。动作保存为平铺字段：connectionId、inboxId、to（地址数组）、text/html；发送可指定 subject，回复需 messageId，可指定 replyAll。JSON 编辑器支持 `{"$event":"message.senders"}` 或 `{"$step":{"index":0,"path":"messageId"}}`，字符串不作模板插值。连接必须属于当前组织且未删除，执行时检查启用状态与邮箱归属。网络发送在短数据库事务之外进行，只有发送成功才提交 messageId/threadId 凭据；400/404 等客户端错误不重试，503 等临时失败沿用 worker 重试。提供商成功后、凭据提交前崩溃仍可能重复发信，不能保证 exactly-once。Agent 工具仍待 slice 3。
