# 开发与生产发布流程问题

按用户 2026-10-20 的反馈修订。前版过多讨论备份命令、等待和重试，没有抓住根因：日常开发交付与生产运维没有通过独立发布流程分开。原始操作复盘保留在本机 .herdr/reports/0095-unified-record-site-closeout/retrospective-original.md。

## 用户要求

- 本地开发与生产环境隔离。
- 本地开发不承担生产备份、生产发布审批和线上验收流程；仍需正常的本地构建与必要测试。
- 普通提交、push 和合并不构成生产发布授权。
- 生产需要明确的人工确认；确认之后，备份、迁移、部署、验证由自动化完成，用户无需手工执行运维命令。
- 支持用版本 tag 触发发布流程。具体人工确认入口在方案确定时明确，不能由 agent 自行解释普通提交为放行。

## 已核实的现状

| 项目 | 当前状态 | 问题 |
| --- | --- | --- |
| 本地运行 | development 模式只加载对应环境文件，检查本地数据库、Redis 和文件存储 | 这一层已经有隔离，不能笼统说所有环境完全混用 |
| 普通 CI | .github/workflows/ci.yml 对 master、feat 分支 push 和 master PR 做构建、类型与测试 | CI 本身应保留，但通过不应自动代表生产发布获批 |
| Railway 来源 | API、worker 均配置监听 master，开启 checkSuites | 普通 master 更新与生产部署耦合；等待 CI 不提供人工发布确认 |
| 发布流水线 | 当前仅有 ci.yml，没有独立 tag 发布 workflow | 缺少版本发布入口，以及统一的自动化备份、迁移、部署和验收编排 |
| 本次操作 | 由开发会话直接协调生产备份、停止服务、迁移和部署 | 运维步骤侵入日常开发，增加耗时，并在新制品就绪前停止生产服务 |

## 应当解决的根因

1. **开发完成与上线混为同一个完成条件。** 日常任务应结束于本地验证、review 和代码交付；生产上线由另一个明确触发的流程负责。
2. **缺少人工确认与机器执行之间的清晰边界。** 人确认发布哪个版本；机器执行已确认版本的整套流程。不能让用户手动逐条跑命令，也不能让 agent 随意推进生产。
3. **生产发布靠临时操作，而不是可重复的流水线。** 备份失败重试、迁移顺序和状态轮询不应每次临场安排。
4. **环境变量隔离之外，发布权限和触发器也需要隔离。** 生产凭证应由生产发布任务使用；普通开发和 PR CI 不应得到生产凭证。测试数据、Redis 命名空间和文件存储也应各自独立。

## 建议的目标流程（方案，尚未配置）

日常开发：

feature 分支 → 本地验证 → PR review / CI → 合并 master；全程不触发生产发布。

生产发布：

人工确认版本 → 发布受保护的 vX.Y.Z tag → 对 tag 对应的确切提交校验并构建制品 → 自动生产备份（涉及数据库迁移时）→ 执行兼容迁移 → 部署同一版本的 API 与 worker → 健康检查和冒烟验证 → 记录发布结果。

人工确认可以有两种实现，配置前应确定一种：

- **tag 就是确认**：由人工发布，或人工明确授权发布指定 tag；之后全自动，不增加重复审批。agent 不自行创建或推送生产 tag。
- **tag 后审批**：tag 自动启动校验和构建；GitHub production Environment 的人工 Approve 才放行生产任务。适用于需要平台强制审批的方式。

两种方式都不是让用户手工备份、SSH、迁移或操作 Railway。tag 只是触发与版本标识，不会天然提供人工审批；必须同时配置权限或审批规则。

## 落地验收标准

- [ ] 关闭 Railway 对普通 master push 的生产自动部署，同时更新 IaC，防止后续配置应用重新启用。
- [ ] 保留普通 CI；增加独立、只接受正式版本 tag 的生产发布 workflow，禁止任意分支提交绕过发布校验。
- [ ] 明确人工确认规则，并在 GitHub 配置 tag 限制或 production Environment 审批；没有确认不得访问生产步骤。
- [ ] 生产凭证与开发、PR CI 分开；生产 workflow 明确指定项目、环境、服务和对应提交，不能依赖 CLI 当前链接状态。
- [ ] 自动化校验版本与提交来源；构建完成后再进入生产操作，API 与 worker 使用同一版本制品。
- [ ] 迁移前自动确认恢复点可用；失败则停止后续步骤，不默认先停止线上服务。
- [ ] 自动执行兼容迁移、部署、健康和必要冒烟检查，输出版本、提交、部署 ID 与检查结果；发布串行执行，不能中途取消正在进行的迁移。
- [ ] 应用失败回退到已知可用版本；数据库恢复单独处理，不能把镜像回退等同于数据回滚。
- [ ] 验证普通开发 push 不会发布；通过测试版本验证 tag 流程，不未经授权发布生产。

当前只修订问题定义和方案，没有修改 GitHub/Railway 平台设置，也没有创建、推送 tag 或触发生产发布。

## 官方能力依据

- [GitHub Actions 的分支和 tag 触发器](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Environment 与人工审批](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Railway GitHub 自动部署及关闭方式](https://docs.railway.com/deployments/github-autodeploys)
- [Railway CLI 自动部署与环境范围 token](https://docs.railway.com/cli/deploying)
