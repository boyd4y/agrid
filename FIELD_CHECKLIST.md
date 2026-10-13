# 表格字段操作完整性清单

审计并补全（Feishu / Notion 风格 MVP）。UI 与 Agent（`/api/commands` + AI tools）共用 `@tabdo/shared` 命令层与 `applyFilters`。

| 能力 | 审计前 | 现状 | 说明 |
|------|--------|------|------|
| 列创建 | ✅ | ✅ | 弹窗选类型；select 带默认选项 |
| 列重命名 | ✅ 弱 | ✅ | 列设置面板 / `updateColumn` |
| 列删除 | ✅ | ✅ | 列设置 + API |
| 列类型变更 | ❌ | ✅ | 列设置改类型；不兼容单元格清空为 null |
| Select 选项 CRUD | ❌ | ✅ | 列设置：增删改标签/颜色 |
| 列重排 | ❌ | ✅ | 左移/右移 → `reorderColumns` |
| 列宽拖拽 resize | ❌ | ✅ | 表头右缘拖拽，松手持久化 width |
| 列隐藏 / 恢复 | ❌ | ✅ | `config.hidden`；工具条一键恢复 |
| 单元格编辑 · text | ✅ | ✅ | |
| 单元格编辑 · number | ✅ | ✅ | NaN 校验 |
| 单元格编辑 · select | ✅ | ✅ | |
| 单元格编辑 · multi_select | ✅ | ✅ | |
| 单元格编辑 · date | ✅ | ✅ | YYYY-MM-DD 校验 |
| 单元格编辑 · checkbox | ✅ | ✅ | |
| 单元格编辑 · person | ⚠️ 自由文本 | ✅ | 成员/Agent 选择器（`userId`）；无成员时回退文本 |
| 服务端校验 | ❌ | ✅ | `validateCell` 在 updateCell/updateCells/addRow |
| **筛选 Filters** | ❌ | ✅ | 每列条件 + AND/OR；`applyFilters` 共享；Agent: `queryRows` / `query_rows` |
| 排序 Sort | ❌ | ✅ | 点列头升/降/清；与筛选共用 |
| 批量编辑 bulk | ❌ 未草图 | ⏭ 二期 | 未做多选行批量填值 |
| 公式列 | ❌ | ✅ | `type=formula`；`{列名}` 引用；改依赖格自动重算；只读；人机共用 |
| 人机成员字段 | ⚠️ | ✅ | person 对齐 members API（human + agent） |

## Agent 对应 tools / commands

- `query_rows` / `queryRows`
- `update_column` / `updateColumn`
- `reorder_columns` / `reorderColumns`
- 原有 CRUD + `set_status` / `move_card`

## 筛选示例（Agent）

```json
{
  "command": "queryRows",
  "input": {
    "tableId": "…",
    "filterLogic": "and",
    "filters": [
      { "id": "1", "columnId": "…状态…", "op": "eq", "value": "doing" }
    ],
    "sort": { "columnId": "…标题…", "direction": "asc" }
  }
}
```
