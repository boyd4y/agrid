---
name: automation
description: 在表格变化、Webhook、收到邮件或定时发生时，持续执行数据操作或指定智能体任务，设计规则并核对执行结果。
---
# 让后续事件推进工作

适用于“以后每次发生时都做”或定时任务。输入是事件来源、目标效果、条件、目标数据或智能体；输出是保存的自动化规则及实际执行状态。一次性整理、导入或生成 mock 数据使用 table 的 batch_*，数量多不代表需要持续规则。

## 来源到执行

1. 确认事件确实可到达：表格需真实 tableId；Webhook 需已创建的 endpointId；AgentMail 需已连接账户及订阅邮箱；定时需五段 cron 和明确 IANA 时区。来源与触发的对应关系见 [references/sources-and-bindings.md](references/sources-and-bindings.md)。外部连接与密钥由设置 UI 配置，不编造 ID、密钥或工具。
2. 明确范围：表格来源用真实字段条件；其他来源用事件路径条件，不能要求不存在的触发 rowId。只监听所需状态或变化，不为不确定判断建立永久规则。
3. 选择确定的数据操作或智能体任务。数据动作用 {type:"command",command,input}，命令名为共享 schema 的 camelCase，不是工具的 snake_case；字段和值仍遵守 table 技能。run_agent 必须指定实际 agentUserId 和具体 prompt，不能把普通字段更新说成 AI 调用。
4. 创建规则后读取 list_automations 核对来源、条件、动作与 enabled。可按 tableId 筛选；无表格来源无需绑定表。需要从事件或前序动作取值时读绑定参考。
5. 按 [references/testing.md](references/testing.md) 引发可识别的事件并查看 list_automation_runs。保存成功、已排队、原生 Agent 完成和数据写入完成是不同结果。

## 场景与组合

读 [references/workflows.md](references/workflows.md) 选择流程：报名表新增后整理字段，收到邮件后建立记录，或每周让指定智能体检查项目。先用 table 准备目标结构，用 form 收集资料，用 report 看结果；只配置用户需要的持续部分。

## 失败与边界

多步动作按顺序提交，后一步失败不撤销已经完成的前一步。核对执行记录与实际数据后修正规则，不重复发送有副作用的事件来“试试”。原生 Agent waiting_input 时打开关联对话回答；unknown 表示结果尚不确定，查看原对话，不重新创建同一任务替代恢复。

邮件集成支持入站事件及 send_email / reply_email 出站动作和工具；发送前用 list_mail_inboxes 确认当前组织可用邮箱与真实 connectionId、inboxId。未连接时先将草稿保存到表格，不声称发送成功；只有发送工具成功后才能报告已发送。不能下载附件，附件元数据不代表已读取内容。定时执行需要服务端 worker 运行，不能承诺浏览器关闭后本机已停止服务仍执行。规划和提问由真实 Harness 原生能力提供，不创建平台 goal/plan 门禁，也不另写 Agent 工具循环。
