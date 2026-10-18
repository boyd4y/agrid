# 仓库文档索引

这里是仓库内的开发与产品资料入口，与网站公开的 `/docs` 页面分开维护。

## 产品与设计

- [产品定位](../PRODUCT.md)：目标用户、产品边界与表达方式。
- [设计规范](../DESIGN.md)：界面、主题、组件与品牌约定。
- [品牌资料](brand/README.md)：定位文案、标志资源与使用规范。
- [Scenario A：房产经纪人](brand/scenario-a-real-estate.md)：`playbook` 技能 + `real-estate-broker` reference；跟进草稿与真实发信配置。
- [场景案例](brand/use-cases.md)：四个案例的 setup、演示路径与功能边界。

## 功能与数据

- [表单视图](form-view.md)：数据模型、交互设计与实施记录，规划项以文内状态为准。
- [表格关联与汇总](table-relations.md)：关系、聚合、命令、并发与删除行为。
- [名称唯一性](name-uniqueness.md)：表格和字段的作用域及数据库约束。
- [文件字段与存储](file-storage.md)：单多文件、本地与 S3 存储配置。
- [事件自动化与定时任务](event-automations.md)：来源、条件、数据动作与智能体运行。
- [AgentMail 与 Webhook](integrations.md)：连接设置、凭证、接收接口与验收边界。
- [API Key](user-api-keys.md)：逐表 CRUD 权限、创建、存储与删除。

## 架构与执行

- [Node + Harness 架构](architecture/node-harness.md)：官方工具桥接、会话生命周期、本地与 Railway。
- [运行时与包边界](architecture/runtime-boundaries.md)：core/db/auth、通用能力、server 业务与部署入口。
- [包边界评审](architecture/package-review.md)：queue 职责下沉、db 薄封装问题与其余包的保留依据。
- [Queue / Worker 拆分计划](architecture/queue-worker-plan.md)：消息传输与任务执行两包的依赖、迁移步骤和验收记录。
- [Pars 核心调研](architecture/pars-review.md)：历史调研资料，不代表当前部署目标。

- [多租户设计](multi-tenant.md)：工作区隔离、身份与数据模型。
- [Agent 运行](agent-runtime.md)：Chat、Session、Run 与原生 Harness。
- [SDK 对齐](sdk-alignment.md)：原生历史、提问与工具契约。
- [自动化可靠性](automation-reliability.md)：事务 outbox、队列领取、重试与补偿。

## 开发、测试与部署

- [本地 Node 部署](local-node.md)：同源前端/API、独立 worker、隔离基础服务与实际流程检查。
- [Railway 部署](railway.md)：API、worker、PostgreSQL、Redis、S3 与远程 Agent Sandbox。
- [贡献指南](../AGENTS.md)：目录结构、命令与提交约定。
- [测试指南](testing.md)：单元、集成、队列与浏览器回归，以及隔离环境。
- [shadcn CLI](shadcn-cli.md)：多包工作区的组件命令。
- [数据库迁移](migrations.md)：迁移顺序、修复与历史数据处理。
- [Worker 部署](workers.md)：后台进程与 Compose 配置。
- [头像资源署名](avatar-credits.md)：资源来源、许可证与生成方式。

## 任务、设计依据与审计

- [持续任务](roadmap.md)：任务推进记录，历史状态按文内时间理解。
- [集成设计依据](integrations-design.md)：初始方案与审计基线。
- [Agent Run 审核](agent-run-audit.md)：执行链路审核范围与验证结论。
- [Skill Review](skills-review.md)：内置技能场景与能力边界。
- [历史归档](archive/README.md)：早期迭代、字段与主题审计。

## 维护约定

根目录只保留 `README.md`、`AGENTS.md`、`PRODUCT.md`、`DESIGN.md` 四个长期入口；产品与设计文件留在根目录供现有工具读取。功能和开发说明放在 `docs/`，使用小写连字符文件名；历史快照放在 `docs/archive/`，注明时间与验证范围。包专属说明仍放在对应包内。

新增、移动或重命名文档时，同步更新本索引和相对链接。现行说明维护实际行为；历史审计保留当时结论，避免把旧测试结果或规划项写成当前能力承诺。
