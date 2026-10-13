# 页面布局与图表选择

每页最多40个组件：chart、metric、text。text 为说明，不执行 Markdown 中的命令或动态表达式。每个 chart / metric 具有独立 query 和来源 tableId。当前 UI 比例类和 radar 最多显示前12组，其他图表最多40组；这是显示窗口，和服务端最多200组的截断不同。

## 布局

layout={x,y,w,h} 使用12列：x=0..11、y=0..10000、w=3..12、h=4..30，x+w≤12，不允许重叠。省略 layout 时自动寻找空位；width=half/full 和页面 columns=1/2 决定默认宽度，不会自动搬动已有明确位置。

set_report_layout 原子修改全部组件位置；reorder_report_widgets 将全部组件重新纵向排布并保留大小。两者都必须提交全部且唯一的组件 UUID，不能只提供希望改动的一项。

update_report_widget 传完整组件；修改前 get_report 取得当前配置，避免丢掉 query、width 或 layout。组件来源未完整选择时可以保存草稿，但 get_report_data.data=null 不能算已得到统计结果。

## 图表

- bar / bar-horizontal：比较分组；line / area：按分组 key 排序，日期分组适合趋势，文本分组不代表时间轴。
- pie / donut / treemap：展示组成；负数不支持，零总量或缺失值不能编造占比。radial 以显示组中的最大值作为量程，不是自动计算占总量百分比；同样不支持负数。
- radar：比较分组汇总，并非自动归一化的多维评分。
- scatter：横轴是每组记录数，纵轴是汇总值；不是逐记录的任意两个数值列散点图。
- funnel：保持返回的分组顺序；只有真实阶段与可靠流程口径才可以讨论转化，不能把类别分布当转化率。

原始数据的负数可用于有意义的条形或折线比较；比例类不适合时换图，不擅自取绝对值或删除负数。核对实际 points、records 和缺失值后再描述观察到的结论。
