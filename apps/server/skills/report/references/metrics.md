# 统计口径与来源范围

get_report_data 在服务端对完整来源表聚合，不从 query_rows 的第一页计算总计。组件 query 不接受 filters、联表或日期范围；独立 query_rows 筛选也不会改变报告来源。

| 方式 | 字段要求 | 空值 | 无记录 |
| --- | --- | --- | --- |
| count | 不需要值字段 | 计入记录数量 | 0 |
| sum | number 字段 | 不参与求和 | null |
| average | number 字段 | 不参与分母 | null |

图表分组字段仅支持 text、select、date、checkbox，必须属于同一来源表。求和/平均只支持 number 列，不能把数值公式、汇总、文本或关联字段直接当作 number 来源。日期分桶为 day / month，按保存的日期归组；dateBucket=month 不意味着仅统计当前月。

## 截断、分页与验收

图表按分组 key 排序，最多返回200组。读取 truncated 和 totalRows：截断时不能将图中点值或记录数相加当作全体总计，也不能声称按值排行的前200组；独立 metric 查询总体统计。null/空分组显示“未填写”，不是另一种完整数据。

list_reports 按 offset 分页并读取 hasMore；query_rows 用 nextCursor / hasMore 浏览记录。两者的窗口不能代替服务端总体聚合。验收核对每个组件来源、字段、metric、totalRows 与 error；跨来源组件的总数不默认相加。

## CSV 脱机分析

脚本只读显式提供的 UTF-8 CSV，不连接产品数据库、不读取访问令牌；其统计不会自动写回报告。先确认 Python 和文件真实可读，再按实际表头运行：

```sh
python3 scripts/summarize-csv.py /workspace/provided.csv --group category --metric sum --value amount
```

count 可省略 --value；sum / average 必须指定数值表头。空数值不计入求和或平均，非法数值或缺失表头会失败。不要凭脚本内容声称已执行，也不要将产品文件 UUID 当作 /workspace 文件路径。
