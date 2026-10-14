# 来源、动作与绑定

## 四种来源

| source | trigger | 可引用的事件数据 |
| --- | --- | --- |
| {kind:"table",tableId} | row_created / field_changed{columnId,toValue?} / enter_status{columnId,optionId} | row.id、cells.字段UUID、tableId、rowId；修改事件含 before/after |
| {kind:"webhook",endpointId} | webhook_received | payload 中的实际 JSON 数据 |
| {kind:"agentmail",connectionId,inboxId} | message_received | message.messageId/inboxId/threadId/subject/text/html/senders/to/receivedAt/attachments |
| {kind:"schedule",cron,timeZone} | schedule_due | scheduledFor、dispatchedAt、timeZone、delayed |

外部事件还有 id、source、type、occurredAt、traceId。仅引用实际存在的路径，缺失字段引用会报错，不默默变空。邮件正文可能缺失，由受控官方 API 在执行前补取；HTML-only 不等于已有纯文本。附件只含元数据，没有文件内容或可用下载工具。message.receivedAt 是完整 ISO 时间，不能直接写 date 列（YYYY-MM-DD）；senders / to 是字符串数组，不能直接绑定 text。可用 text 保存接收时间，或让智能体实际转换后写入正确类型。

表格 conditions 使用 {id,columnId,op,value?}；非表格 eventConditions 使用 {id,path,op,value?}，如 path="message.subject"。逻辑用 conditionLogic="and" / "or"。不要把非表格事件条件写成表格字段条件；非表格来源不能用 update_field，因为没有默认触发记录。

定时例子 cron="0 9 * * 1"、timeZone="Asia/Shanghai" 表示每周一当地9点。服务中断后合并处理一次到期事件，再计算未来时间，不补发所有错过的分钟；只针对已启用规则。

## 数据动作 schema

动作形如 {type:"command",command:"addRow",input:{tableId,cells}}。当前22个命令：

| 操作 | command |
| --- | --- |
| 记录 | addRow、updateCell、updateCells、deleteRow、setStatus、moveCard |
| 关联 | setRelation、addRelation、removeRelation |
| 字段 | addColumn、updateColumn、deleteColumn、reorderColumns |
| 批量记录 | batchAddRows、batchUpdateRows、batchDeleteRows |
| 批量字段 | batchAddColumns、batchUpdateColumns、batchDeleteColumns |
| 批量关联 | batchSetRelations、batchAddRelations、batchRemoveRelations |

命令 input 遵循共享 command schema，addColumn 配置放 config，record/cells 使用真实 UUID；每个 batch 最多100项且单动作原子。不是所有平台工具都可作为自动化 command，不能写 create_table、create_report 或发信命令。table 来源还可用 update_field{columnId,value} 设置触发记录的固定值。

## 类型保持与前序结果

命令输入的精确引用对象保留原 JSON 类型：

```json
{"$event":"message.subject"}
```

第一个 command 动作的返回值存于 steps[0].result，引用新建记录 ID 使用：

```json
{"$step":{"index":0,"path":"result.id"}}
```

使用 list_members(kind=agent) 按姓名查询真实智能体 userId；agentUserId 填返回的 userId，不是成员记录 id。不按姓名猜 ID，匹配不唯一时再澄清。

run_agent 的动作结果直接包含 text、threadId、agentRunId、status，后续引用其文字用 path="text"，不要假设 text 自动解析成对象。引用只能指向已经完成的前序动作，不能循环或访问未来步骤。

智能体任务形如 {type:"run_agent",agentUserId,prompt}；prompt 文本插值可写 {{event.message.subject}}、{{steps.0.result.id}}。对象会序列化成 JSON，不执行表达式或 JS。实际调用使用既有 Harness 原生运行与关联私有对话，不产生另一个工具循环，也不伪造 AI 结果。
