# 视图

意向客户、房源各有两种视图，先 list_views 并读取真实字段 ID，按名称和类型核对，匹配则复用，不重复创建。

| 视图名 | 类型 | 配置 |
| --- | --- | --- |
| 表格 | grid | create_grid_view |
| 看板 | board | create_board_view，statusColumnId 指向本表「状态」字段 UUID，hideEmpty=false，density=comfortable |

已有看板缺少正确分组时使用 update_board_view 对齐所需配置；保留其他用户设置。同名但类型不符时先报告差异。验证两表都可读取表格与看板，状态分组使用选项 ID；拖动演示记录后核对真实状态和自动化运行。
