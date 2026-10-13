# 关联和汇总

一对多和多对多配置见 cardinality.md，先判断业务关系再设置 limit。

1. 用 list_tables 和 get_table 确认来源表、目标表及真实 UUID。
2. 创建关联字段使用 add_column，type=relation，relation.targetTableId 指向目标表。配置 inverseName 才创建双向字段；limit 和 inverseLimit 决定两侧数量限制。
3. add_relation 只向已有字段添加记录，不能创建关系定义。传入源记录 rowId、已存在字段 columnId 和目标 recordIds 数组。
4. 搜索目标候选用 query_relation_records；已关联记录也通过该工具分页读取。不能用显示名称代替记录 UUID。
5. set_relation 整体替换关联，避免覆盖并发更新；增量添加用 add_relation，解除用 remove_relation。解除关联不删除目标记录。
6. 汇总字段用 add_column(type=rollup)，先查阅现有字段和工具 schema。不要承诺当前工具不支持的递归汇总。

确认两侧字段和关联记录实际存在后再报告成功；工具失败时保留已完成步骤并说明未完成部分。
