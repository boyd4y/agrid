# 字段与值

以 get_table 的真实列定义和当前工具 schema 为准。字段名、记录名、选项显示标签都不能代替 ID。

| 类型 | 写入值与约束 |
| --- | --- |
| text | 通常使用字符串 |
| number | 有限数字，不把数字字符串当数值 |
| select / multi_select | 真实选项 ID / 选项 ID 数组 |
| checkbox | 布尔值 |
| date | YYYY-MM-DD；显示格式设置不改变存储格式 |
| person | 当前工作区成员的 userId，不是 member.id；不使用跨工作区成员 |
| relation | 已存在目标记录 UUID 数组；优先专用关联工具表达替换、增量添加或解除 |
| file | 已上传文件 UUID 数组；null 或 [] 表示空 |
| formula / rollup | 只读计算结果，不能用普通单元格工具写入 |

## 文件边界

文件通过产品 UI 上传，工具只能在已有文件 ID 的情况下引用。文件必须归属当前工作区、当前表和当前文件列，不能把其他列的 UUID、文件名、路径或 URL 当作文件值；不能重复 ID。file.multiple 默认 true，false 时最多一个文件，单文件仍用数组。取消引用不立即删除文件对象。

当前没有平台文件上传/解析工具，聊天附件也不能自动转成表格文件。创建文件列或设置 UUID 不表示已解析 PDF、图片、CSV 或邮件附件；只有用户明确提供可读取内容时，才能基于该内容整理数据。

## 字段配置

单条 add_column 的 options、file、formula、relation、rollup 按其工具 schema 传入；batch_add_columns / batch_update_columns 的这些配置位于 config 内。例如批量添加单文件列：

```json
{"name":"资料","type":"file","config":{"file":{"multiple":false}}}
```

不要给 update_column 传它未提供的配置字段；需要批量 schema 支持的配置时使用对应 batch 工具。改单选选项或字段类型前查看已有数据及依赖，依赖错误不通过删除其他字段绕过。

分配负责人前用 list_members 按姓名或邮箱查找当前工作区成员，person 填返回的 userId。kind=human 查人员，kind=agent 查智能体（含人设）；自动化 agentUserId 同样使用智能体的 userId。id 是成员记录 ID，不能代替 userId。结果有多名匹配时再澄清，不要求用户手动找 ID。get_workspace 可查看当前工作区与执行身份。
