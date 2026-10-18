# 自动化

先用 list_automations 分页盘点，按未删除规则名称复用；匹配则跳过，保留用户启停和配置，仅按用户要求增量修改。新规则 enabled=true、conditions=[]、conditionLogic=and，每条 actions 仅一个 `{type:"run_agent", agentUserId, prompt}`；agentUserId 必须来自真实经纪人智能体 userId。缺少该智能体时先完成成员配置再建规则。

表格 source 使用意向客户的真实 tableId，trigger.columnId 使用「状态」的实际 UUID；optionId 使用稳定选项 ID。以下为各规则应使用的 prompt 原文。

## 状态进入已约看 → 提醒

source: `{kind:"table", tableId}`；trigger: `{type:"enter_status", columnId, optionId:"scheduled"}`。仅有可靠日期时更新下次跟进，保留备注，不发外部通知。

prompt：

> 读取触发事件对应的意向客户记录及关联房源，用工具核实状态为已约看后，向负责人提示看房预约。检查下次跟进；必要时依据已有预约信息更新，没有时间则询问，不猜测。把提醒和待补充事项写入备注，保留原内容；不声称已向外部发送通知。

## 每日跟进检查（定时）

source: `{kind:"schedule", cron:"0 9 * * *", timeZone:"Asia/Shanghai"}`；trigger: `{type:"schedule_due"}`。查询今天/逾期且非 won/lost 的客户，追加备注。

prompt：

> 按 Asia/Shanghai 当前日期，用工具查询意向客户中下次跟进为今天或逾期且状态不是成交、流失的记录。汇总客户、日期、意向区域及关联房源；用工具在备注追加明确的待跟进事项，保留原内容。不要修改状态或自动发送邮件；没有匹配记录就如实说明。

## 带看后起草跟进邮件

source: `{kind:"table", tableId}`；trigger: `{type:"enter_status", columnId, optionId:"shown"}`。只保存「跟进邮件草稿」，不发送。

prompt：

> 用工具读取触发事件对应的意向客户，核实状态为已带看，读取意向房源关联的标题/小区、价格和地址。起草简短中文带看后跟进邮件，用工具保存到跟进邮件草稿；不编造客户反馈。缺少邮箱不妨碍起草，明确标记待补充。此自动化只起草，不发送，不声称已发送。

保存后用 list_automations 核对来源、触发、动作、时区与启停，用 list_automation_runs 和实际记录核对执行。状态必须从其他值进入目标状态才触发，同值更新不重复触发；样例初始导入应在创建规则前完成，避免意外触发。定时验收需 worker 持续运行并在上海 09:00 后检查，手动查询不代表定时成功。自动化执行结果、备注和草稿均不代表外部通知送达。
