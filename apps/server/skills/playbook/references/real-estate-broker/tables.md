# 表结构

两张表的 description：`房产经纪人演示：所有客户、房源和地址均为虚构样例，价格/预算单位为万元。` 这是演示标记，不代表已有真实客户资料。图标与置顶通过现有 UI 设置，当前建表工具不提供这些参数。

先建两表，再建立关系。create_table 自带标题列，读取后用 update_column 改名为业务标题，避免另建重复标题列。字段操作遵循 table 技能，写入 cells 使用实际字段 UUID。

## 意向客户

名称：意向客户；图标：Contact。

| 字段 | 类型 | 配置 |
| --- | --- | --- |
| 客户姓名 | text | 标题列 |
| 手机 | text | 样例留空 |
| 邮箱 | text | 样例使用 example.com |
| 状态 | select | 见下表 |
| 下次跟进 | date | 日期 |
| 预算 | number | 万元 |
| 意向区域 | text | 区域 |
| 备注 | text | 更新时保留原文 |
| 跟进邮件草稿 | text | 仅保存草稿 |
| 意向房源 | relation | 指向房源，many ↔ many，反向字段名「意向客户」 |

| 状态标签 | 稳定 ID | 颜色 |
| --- | --- | --- |
| 新线索 | lead | #ebeced |
| 跟进中 | follow | #d3e5ef |
| 已约看 | scheduled | #fadec9 |
| 已带看 | shown | #e8deee |
| 成交 | won | #dbeddb |
| 流失 | lost | #ffe2dd |

使用 add_column(type=relation)，relation 指定真实 targetTableId、limit=many、inverseName=意向客户、inverseLimit=many。复用自动生成的反向列，不再手建同名列。已有字段需核对类型、选项 ID 与关联目标，不按标签猜 ID，不覆盖冲突配置。

## 房源

名称：房源；图标：House。

| 字段 | 类型 | 配置 |
| --- | --- | --- |
| 标题/小区 | text | 标题列 |
| 状态 | select | 在售=available（#ebeced）、已定=reserved（#d3e5ef）、下架=off_market（#fadec9） |
| 价格 | number | 万元 |
| 面积 | number | ㎡ |
| 地址 | text | 演示地址标注虚构 |
| 下次跟进 | date | 可空 |
| 备注 | text | 保留原内容 |
| 意向客户 | relation | 由意向房源自动生成的反向列，many |
