# 双向关联的数量限制

| 源字段 limit | 反向字段 inverseLimit | 例子 |
| --- | --- | --- |
| one | many | 联系人 → 客户；客户 → 多个联系人 |
| one | many | 商机 → 客户；客户 → 多个商机 |
| many | many | 活动记录 ↔ 联系人 |

双向字段共享同一组关系边。反向不是另外写一份关联值，增加或解除源侧关联会反映到另一侧。

建立关系定义使用 add_column(type=relation)，inverseName 是另一侧字段的名称。给实际记录添加关联使用 add_relation，必须传 rowId、columnId、recordIds；targetTableId 是字段配置，不是 add_relation 的输入。

单条数量限制冲突应说明具体记录和字段，不应自动删除旧关联。set_relation 整体替换前应确认用户意图并使用 expectedVersion。
