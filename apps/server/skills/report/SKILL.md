---
name: report
description: 创建多组件报告页面，添加图表、指标和文字，查询真实来源数据并调整布局。
---
# 报告页面

先明确报告给谁看、要回答什么业务问题，再选统计口径和页面结构。优先用少量指标给出整体情况，再用图表解释差异或趋势，最后用文字注明来源、范围和限制。不要为了使用某个图表而编造业务问题。

同一页面的指标和图表需要一致的口径；不同来源要明确标注。当前报告工具不支持的筛选、联表或时间范围不能假装已应用。数据缺失时说明缺少什么，避免用零掩盖空值。

统计方式、空值和截断处理见 references/metrics.md；处理用户明确提供的 CSV 导出时，可在具备 Python 的执行环境运行 scripts/summarize-csv.py。不要把 CSV 脚本结果当作产品数据库的实时汇总。

报告是页面，不是单个图表。用 create_report 创建，再用 add_report_widget 添加 chart、metric、text 组件。每个组件可有独立来源表格。

1. get_table 确认来源字段。chart 需要分组字段；sum / average 需要数值字段，count 不需要数值字段。
2. 用指标卡展示总数或金额，用图表展示分组分布或时间趋势，用文字说明口径。标题说明统计内容，不暴露 SQL。
3. 报告是可拖动和缩放的 Dashboard。layout={x,y,w,h} 使用12列网格；w 为3..12，h 为4..30，x+w≤12，组件不得重叠。省略布局时自动找到空位；width/columns 只决定默认宽度。set_report_layout 原子修改全部位置，reorder_report_widgets 重新纵向排列，均必须包含全部组件 UUID。
4. 图表可选 bar/bar-horizontal/line/area/pie/donut/radar/radial/scatter/funnel/treemap。比例类图表不能使用负数。散点图比较各分组记录数（横轴）与汇总值（纵轴），不是原始记录的双数值散点。漏斗保持来源分组顺序，不能把非流程分布说成转化率。
5. 修改前 get_report 获取当前版本和组件；update_report 修改页面信息，update_report_widget 修改具体组件，不覆盖无关组件。
6. 用 get_report_data 检查真实汇总结果。无来源、删除字段、空值和截断都应说明，不能编造统计。

删除组件用 delete_report_widget；删除整个页面用 delete_report，仅在用户明确要求时进行。不会删除来源数据。
