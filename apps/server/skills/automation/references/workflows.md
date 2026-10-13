# 可落地的持续流程

示例字段与来源 ID 需先从真实资源取得；以下结构说明选择与交接，不包含可冒用的 UUID。

## 报名后标记待整理

目标：新报名出现时，把已存在的状态列设为“待整理”。先用 table 建好列和选项、form 配置报名表，随后创建 table 来源的 row_created 规则，动作 update_field 使用真实 columnId 和选项 ID。UI 提交一条明确测试报名，查询记录并核对执行 completed；这既验证收集，也验证触发后的字段更新。

需要 AI 判断时再用 run_agent，并提供明确任务，例如“检查本次记录的缺失信息，汇报需要人工补充的项目”。确定的字段写入无需 AI。自动化内部数据命令不会自行形成无限级联；Agent 调用业务工具产生的变更仍需检查后续规则，避免互相触发。

## 收到邮件后建立资料记录

目标：收到订阅邮箱的邮件时，在已有资料表记录主题和正文。

1. 在设置 UI 连接 AgentMail 并为邮箱注册事件；取得实际 connectionId、inboxId。此流程只接收，不发送或回复邮件。
2. get_table 确认目标标题、正文 text 等字段；创建 agentmail 来源的 message_received 规则，按需使用 message.subject 条件。
3. 使用 command="addRow"，input.cells 的标题值为 {"$event":"message.subject"}，正文值为 {"$event":"message.text"}；先确认纯文本值是否存在，HTML-only 不能假装有纯文本。
4. 若随后由智能体整理，run_agent prompt 可引用 {{steps.0.result.id}}，让它对新记录执行具体任务。结果 text 是文字，不能当结构化字段结果自动写回。
5. 以实际邮件内容为依据，核对执行步骤及目标记录；缺失正文按真实结果处理。附件只能保存说明性的元数据，不能当成已上传 file UUID。

## 每周检查项目

目标：每周一9点由已选智能体查看现有项目表，整理近期需要关注的任务。

source={kind:"schedule",cron:"0 9 * * 1",timeZone:"Asia/Shanghai"}，trigger={type:"schedule_due"}，动作 run_agent 指定真实 agentUserId，并在 prompt 写明表 ID、查询范围、需要的输出与允许的数据操作。定时来源无需伪造 table/row；智能体根据工具实际分页查询。

报告可直接反映来源数据，但不支持把智能体自由文字变为动态报告 query。需要持久记录总结时，任务明确要求写入已有总结表，或让后续 command 使用前序 text 写入 text 字段。执行等待提问时在关联对话回答，不重复触发另一轮同任务。

## Webhook 事件登记

已有 generic endpoint 收到可信发送方事件后，command="addRow" 可引用 {"$event":"payload.title"} 等已知 JSON 路径。先检查发送方实际 payload 类型与字段，精确引用保持类型；不把所有 JSON 值强制转换成字符串。设置 UI 创建的 token 仅显示一次，Skill 不要求用户把 token 写进 prompt 或表格。
