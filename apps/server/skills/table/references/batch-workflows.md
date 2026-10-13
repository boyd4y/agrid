# 一次性整理与批量恢复

## 例子：整理读书资料

用户已提供书名、作者和阅读状态，希望得到可维护清单：

1. 查找或创建目标表，读取标题列 ID；补作者 text、阅读状态 select 等必要字段。
2. 将状态标签映射到新建或已有的真实选项 ID。缺失信息保留空值，不编造来源。
3. batch_add_rows 输入为 {tableId,rows:[{cells:{字段UUID:值}}]}，每批1–100条。保存成功 count、rowIds，再查询几条核对内容。
4. 如希望每次进入“读完”状态后执行任务，再交 automation；本次导入本身不创建规则。

## 选择操作语义

| 目标 | 工具与关键输入 |
| --- | --- |
| 新增记录 | batch_add_rows：tableId、rows |
| 修改现有记录 | batch_update_rows：updates，每项 rowId、cells、可选 expectedVersion |
| 删除指定记录 | batch_delete_rows：rowIds |
| 创建字段 | batch_add_columns：同一 tableId、columns；配置放 config |
| 修改字段 | batch_update_columns：columns，每项真实 columnId 与待改属性 |
| 删除字段 | batch_delete_columns：columnIds；原有依赖校验仍有效 |
| 替换 / 增加 / 解除关联 | batch_set_relations / batch_add_relations / batch_remove_relations：relations，每项 rowId、columnId、recordIds、可选 expectedVersion |

每个工具单批1–100项且整批原子提交；不同批次不是一个全局事务。记录批量更新只 patch 指定 cells，列更新只调整提供的属性；替换关联会覆盖整个该字段关联集合，增量添加保留其他关联，解除不删除目标记录。关联数量限制仍由真实字段定义决定。

## 失败与核对

- 参数、归属或依赖错误：该批回滚，修正具体项后再执行；不声称部分项已写入。
- expectedVersion 冲突：重新 get_row / query_rows 检查当前值，再决定是否仍需修改。
- 某批失败但前批已成功：列出已成功 count / IDs 和待处理部分，不重发成功批次。
- 网络中断且结果未知：新增记录不能假定幂等；先查询已保存记录、核对用户提供的识别信息，再决定是否补写。不要因为没有收到回复就整批重复新增。

验收按实际成功结果与查询内容进行；仅看 rowCount 增长不能证明字段映射正确。
