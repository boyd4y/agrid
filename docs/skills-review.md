# 内置 Skill 审核

2026-10-14，范围为 `apps/server/skills` 的 table、form、automation、report 四个只读内置包及其真实工具契约。保留现有技能分配、启用方式与 CSV 脚本，不增加第五个技能或应用层执行逻辑。

## 本轮整改

| 技能 | 目标与流程 | 核对的能力边界 |
| --- | --- | --- |
| table | 清单/项目目标 → 字段和关系 → 实际写入 → 分页核对；补一次性资料整理和失败恢复参考 | 批量每批最多100项且原子，不同批次不整体回滚；成功批次不重复新增；单工具配置与 batch.config 不混用 |
| form | 收集目的 → 必要字段 → 顺序/分组/布局 → 预览 → UI 实际提交 | 默认全可写列不等于合适的收集表；配置成功不代表提交验证；移除字段不删除底层列 |
| automation | 四来源 → 匹配条件 → 确定数据动作或原生智能体 → 执行核对 | table/webhook/agentmail/schedule 与对应 trigger；22个 camelCase command；事件/前序结果绑定；多步成功结果不会因后一步失败回滚 |
| report | 问题 → 来源范围/口径 → 指标/图表/说明 → 真实聚合核对 | 无筛选、联表或日期范围 query；完整来源聚合；分组字段和数值字段限制；服务端200组及 UI 12/40组窗口；CSV 离线结果不是数据库实时汇总 |

主体给出适用场景、输入输出、关键决策、验收和技能交接；模式参数、例子与恢复放在引用文件，按需阅读。未添加仅为展示而存在的脚本。

## 与真实实现对齐

- 文件列只引用已通过 UI 上传、归属同一列的 UUID，遵守单/多文件配置；不承诺聊天附件上传、解析产品文件或自动映射到执行环境。
- 人员值与 run_agent 选择使用真实 userId，不是 member.id。当前无 list_members/list_agents 工具，先用 UI 选择，不按姓名猜 ID。
- AgentMail 仅入站；正文可在执行前由受控官方 API 补取，HTML-only 与缺纯文本有区别。附件只有元数据，不支持发信/回复/附件下载；ISO 接收时间与数组收件人不可直接写成 date/text。
- 自动化 command 结果引用 `steps[n].result`，原生 Agent 结果为 `steps[n].text` 等字段；JSON 精确引用保留类型，prompt 插值是文字，不执行 JS。
- 原生提问在关联对话回答，unknown 状态先查看原运行，不复制任务重放。无自建 plan/goal 工具、门禁或额外工具循环。
- 四来源的工具查询缺口已经由独立工具提交 `5f635d1` 整改：list_automations 支持工作区 offset/limit 与可选 tableId；list_automation_runs 可按 automationId 查询非表格来源，并保持工作区归属校验。
- skills/runtime 的 HTML 推荐改为能力实情：HTML 单页面、Site 独立包与 client 引用尚未提供，不建立新的拦截。

## 验证范围

验证已通过：既有 `test:skills` 6项（仅 `_agent_test` 数据库）、`test/harness/skills-bundle.test.ts` 1项、四包 frontmatter/格式校验以及本地引用路径检查。前者验证文档解析、只读内置包、分配/启用及附件读取；后者用本机协议 fixture 与官方 Pi read/bash 验证渐进加载、完整引用文件、脚本挂载和撤销恢复。该 fixture 明确证明本地 just-bash 无 Python，不宣称 CSV 脚本已执行。

这验证打包与原生读取契约，不代表真实模型已完成所有场景或真实外部收件、定时、文件解析。未调用真实模型、邮箱或用户数据库。
