# 统计口径

报告统计由 get_report_data 在服务端对完整来源表聚合，不从 query_rows 的第一页计算总计。

| 方式 | 字段要求 | 空值 | 无记录 |
| --- | --- | --- | --- |
| count | 不需要值字段 | 计入记录数量 | 0 |
| sum | number 字段 | 不参与求和 | null |
| average | number 字段 | 不参与分母 | null |

chart 还需要一个来源表中的分组字段。日期可按 day/month 分组；select 的显示标签来自该字段的选项定义。metric 无需分组字段。

分组结果有数量上限，读取 truncated 和 totalRows；不能将截断图表中的点合计当作总体统计。独立 metric 组件可查询总体值。

CSV 脱机分析可使用 ../scripts/summarize-csv.py。脚本只读显式提供的 CSV，不连接产品数据库，不使用访问令牌；其统计不会自动写回报告。
