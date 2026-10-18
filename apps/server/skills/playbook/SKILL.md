---
name: playbook
description: 按场景 playbook reference 在当前工作区搭表、视图、智能体与自动化，并按用户口述增量修改。
---
# 按场景搭建与维护工作区

适用于用户要求搭建、初始化、安装某个场景或行业工作区，或按已命名 playbook reference 修改现有场景。输出是当前工作区实际保存的资源、核对结果及未完成项。

## 从 reference 到可用场景

1. 从 [references/README.md](references/README.md) 找到用户指定的 reference 名称；未明确时依据目标确认，不猜测不存在的行业模板。
2. 读取 `references/<name>/` 的 overview、tables、views、agent、automations 和 sample-data，明确结构、行为与演示验收路径。
3. 用 get_workspace、list_tables、get_table、list_views、list_members（kind=agent）和 list_automations 盘点当前工作区；分页读取完整结果，记录真实资源 ID。
4. 按名称复用匹配资源，只创建缺失的表、字段与关联；默认标题列应改名复用。名称相同且配置匹配则跳过，实现重复执行不重复创建。类型、关联目标或同名资源有冲突时说明差异，不覆盖用户数据。
5. 补齐缺失视图、智能体与自动化。结合 table 技能的字段类型、关联规则和 automation 技能的来源、条件、动作设计，使用现有平台工具；成员身份遵循现有成员查询工具。当前 list_members 只能查询，创建或编辑智能体需通过现有成员 UI/API 完成，再查询真实 userId 绑定 run_agent。工具不能设置的配置如表图标，通过现有 UI 补齐并列为待办，不虚报完成。不发明 create_agent 工具或 HTTP 场景安装端点。
6. 样例数据仅在用户要求或 reference 明确要求时写入；先按样例名称查重，保留已有值与关联，不重复灌入。真实资料与虚构样例明确区分。
7. 按 reference 的演示对话路径验证结构、查询、状态变化、自动化运行及实际写入。没有样例时用用户指定记录；不得为验收擅自生成数据。保存规则不等于执行成功，定时运行依赖 worker 与真实触发时间。
8. 后续按用户口述，用同一套工具增量修改受影响的字段、视图、记录或规则，读取后比较差异；保留其余资源和启停状态，不盲目重跑 seed 或重建整个场景。

## 草稿优先与交付

跟进邮件优先保存到「跟进邮件草稿」。不编造客户事实、手机号、预约或发送结果；只有发送工具成功才可说已发送。虚构样例不能当真实发送目标。尊重 reference 的禁用工具与仅起草限制。

交付实际资源、验证证据与缺口；工具失败时说明已完成部分和下一步，不把未执行步骤写成成功。表与批量记录操作配合 table，持续规则配合 automation；场景细节以 `references/<name>/` 为准。
