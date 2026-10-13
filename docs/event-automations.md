# 事件与定时自动化

自动化使用“来源 → 触发 → 条件 → 动作”。表格变化、邮件、Webhook和定时计划共用动作执行层；外部事件不需要伪造表格或记录。列表显示来源、触发与主要动作，创建分两步，编辑沿用同一个规则组件，运行详情在右侧 Sheet。

## 来源

| 来源 | 配置 | 事件上下文 |
| --- | --- | --- |
| 表格 | 实际 `tableId`；新增记录、字段变化、进入状态 | `row.id`、`row.cells.<columnId>`、`cells`、`before/after/changedColumnIds`（变更事件） |
| Webhook | 集成页创建的通用端点 `endpointId` | `payload`：接收的真实 JSON |
| AgentMail | 已连接且注册收信的 `connectionId + inboxId` | `message.subject/text/html/senders/receivedAt` 等规范字段 |
| 定时 | 五段 cron 与 IANA `timeZone` | `scheduledFor`、`dispatchedAt`、`timeZone`、`delayed` |

表格条件使用真实字段类型控件，外部条件使用安全字段路径与同一过滤操作符。缺失邮件正文先持久入队，再由 worker 补取官方消息；完整条件在动作前复核，不把未加载正文误判为条件失败。未满足条件的候选运行标为 skipped，没有数据动作。

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

## 可靠性

- 每个数据库动作、receipt和步骤游标在同一个事务提交，失败全回滚；重试从未完成步骤开始。
- Webhook持久接收、匹配、运行与outbox在同一事务提交后ACK。Redis或模型不可用不影响已确认投递的保留。
- 表格事件保留触发记录的版本保护；外部事件根据真实目标命令进行租户/类型/版本检查。被本动作修改或删除的记录不被伪装成用户并发更新。
- 自动化数据命令沿用内部 `skipAutomation` 防止无限相互触发；它不是用户可设置参数。原生智能体实际调用平台工具按普通工具规则产生真实数据变更。
- 规则停用/删除、创建者离开工作区会停止后续执行。旧规则迁移不凭空指定管理员，真实编辑保存时记录执行者。
- 普通数据事务可保证效果与receipt一起保存；外部原生工具或远端副作用在进程崩溃边界仍需核对，不能承诺跨系统恰好一次。

## 定时行为

数据库保存下一次执行时间，worker计算到期实例并落入同一outbox。API不依赖浏览器时钟，也不在每个进程里另起无持久定时器。cron-parser处理IANA时区与夏令时，预览返回未来3个UTC时间，由界面显示。

同规则版本与计划时刻只接收一个实例，多个worker不会重复调度。停用删除调度游标；修改规则重新计算下一时刻。停机恢复把积压合并为一次已到期触发，`delayed`说明延迟，随后按当前时间计算下一次，不重放每个错过的分钟。

五段cron当前最小粒度为分钟，暂不支持秒级计划、跨账户权限、自动重跑已执行原生任务或精确计费配额。

## 部署与验收

需要正常执行迁移0023，并运行现有queue进程（开发 `pnpm --filter @tabdo/server queue:dev`，生产 `queue:start`）以及Redis。本地Pi只需要所选模型的凭证；本地开发不要求Vercel凭证。只有选择远程sandbox才要求对应配置。[集成部署](integrations.md)说明加密密钥和公网Webhook地址。

测试使用隔离 `tabdo_agent_test` 与本地真实协议/model fixtures，没有调用用户邮箱、付费模型、S3或用户数据库。生产AgentMail连接和远程Sandbox需配置自己的真实凭证再验收；不能把本地协议测试说成已经收取用户邮件。

原生接口依据：[HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)、[Harness Skills](https://ai-sdk.dev/docs/ai-sdk-harnesses/skills)。调度依据：[cron-parser](https://github.com/harrisiirak/cron-parser)。
