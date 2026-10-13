# 字段与值

- text：字符串；number：有限数字，不能把数字字符串当作数值。
- select：选项 ID，不能用显示标签；multi_select：选项 ID 数组。
- checkbox：布尔值；date：按工具 schema 的日期字符串。
- person：当前工作区成员标识；跨工作区成员不能使用。
- relation：使用关联工具读写记录 ID；不直接修改 JSON 单元格。
- formula / rollup：计算字段，不能用普通 update_cell 写入结果。

实际字段类型枚举和输入以提供的工具 schema 为准。get_table 返回的列定义是操作依据。
