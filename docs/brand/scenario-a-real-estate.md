# Scenario A：房产经纪人

## 产品路径

给智能体分配内置 **`playbook`** 技能，对话要求按 **`real-estate-broker`** reference 搭建或修改当前工作区。

权威内容在：

- `apps/server/skills/playbook/SKILL.md`
- `apps/server/skills/playbook/references/real-estate-broker/`（overview / tables / views / agent / automations / sample-data）

**已移除** `pnpm db:seed:scenario-a` 与相关 seed 代码；不要再跑 seed 初始化该场景。

## 场景摘要

- **意向客户**：客户姓名、手机、邮箱、状态、下次跟进、预算、意向区域、备注、跟进邮件草稿、意向房源。状态：新线索 / 跟进中 / 已约看 / 已带看 / 成交 / 流失（稳定 ID：`lead / follow / scheduled / shown / won / lost`）。
- **房源**：标题/小区、状态（在售 / 已定 / 下架）、价格、面积、地址、下次跟进、备注。价格和预算单位为万元，面积为平方米。
- **房产经纪人**：本地 Pi，分配 `table`、`automation`；`disabledTools: ["send_email", "reply_email"]`。草稿优先，见 agent reference。
- **三条自动化**：状态进入已约看 → 提醒；每日跟进检查（`0 9 * * *`，`Asia/Shanghai`）；带看后起草跟进邮件（只写草稿，不发送）。细节见 automations reference。

样例数据仅在用户要求时按 `sample-data.md` 写入；虚构邮箱/房源不得当真发信。

## 演示对话路径

与 playbook reference `overview.md` 一致：

1. 选择「房产经纪人」：**“查询意向客户，列出今天和逾期需要跟进的客户，说明关联房源。只根据表内数据。”**
2. **“把演示·陈女士改为已约看；预约时间还未确认，备注写明待确认。”**
3. **“把演示·陈女士改为已带看，根据关联房源起草简短跟进邮件，保存到跟进邮件草稿，先不要发送。”**
4. **“读取已保存草稿，指出邮箱、预约和客户反馈还缺什么。”**

未安装样例时，用用户指定记录替换名称；不要把聊天回复当成外部通知已送达。定时验收需 worker 持续运行，并在上海 09:00 后检查运行记录。

## AgentMail 实时发送

依赖 AgentMail 出站工具（`list_mail_inboxes`、`send_email`、`reply_email`）。在 Settings 连接真实 AgentMail，选择当前组织可用邮箱；让智能体先用 `list_mail_inboxes` 核对。替换虚构收件人为你控制的测试地址，检查草稿后再明确要求发送。只有工具成功返回才能说已发送。

未连接时保存草稿并说明原因。playbook 默认禁用经纪人的 `send_email` / `reply_email`。`send_email` 的 `connectionId` 必须是真实 UUID；可在连接后手动创建初始禁用的发送自动化，审核后再启用。动作模板：

```json
{
  "type": "send_email",
  "connectionId": "<Settings 中的真实连接 UUID>",
  "inboxId": "<list_mail_inboxes 返回的当前组织邮箱 ID>",
  "to": ["<你控制的真实测试邮箱>"],
  "subject": "带看后跟进",
  "text": "<审核后的跟进邮件草稿>"
}
```

## 验证边界

用 playbook 在演示工作区搭好后，按上面四步对话验收。看板拖动触发、定时调度及真实邮件投递需在隔离环境验证；单元 fixture 不能替代这些验证。
