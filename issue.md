# 开发与生产发布流程问题

按用户 2026-10-20 的反馈维护。根因是日常开发交付与生产运维没有通过独立发布流程分开，而不是备份命令、等待或重试本身。原始操作复盘保留在本机 `.herdr/reports/0095-unified-record-site-closeout/retrospective-original.md`。

## 用户要求

- 本地开发与生产环境隔离；本地开发不承担生产备份、发布审批和线上验收，但仍做正常本地构建与必要测试。
- 普通提交、push、合并和 CI 不构成生产发布授权。
- 生产需要明确的人工确认；确认后，自动化负责备份、迁移、部署和验证，用户不必手工执行运维命令。
- 用正式版本 tag 触发生产流程，明确人工确认入口，不能把普通提交解释为上线许可。

## 问题根因

1. **开发完成与上线混为同一个完成条件。** 日常任务应结束于本地验证、review 和代码交付；生产上线由单独、明确触发的流程负责。
2. **人工确认与机器执行边界不清。** 人确认发布哪个版本；机器执行该版本的发布流程。不能要求用户手工逐条跑运维命令，也不能让 agent 自行推进生产。
3. **生产发布依赖临时操作。** 备份、迁移、部署和状态核验需要形成可重复流程。
4. **环境隔离之外，发布权限和触发器也要隔离。** 生产凭证应只供生产发布任务使用；普通开发和 PR CI 不应得到生产凭证。测试数据库、Redis 命名空间和文件存储也应保持独立。

## 当前进展（2026-10-20）

- [x] 普通 CI 与正式 tag 发布分开；`.github/workflows/release.yml` 只监听 `v*` tag，推送普通分支不会触发该发布工作流。
- [x] Railway API、worker 的 `master` 自动部署已断开；API 旧迁移 `preDeploy` hook 已清空。两服务 active/latest deployment 均为 `SUCCESS`，公开 `/api/health` 和 schema 检查通过。
- [x] GitHub `tabdo / production` Environment 来源限制为 `v*` tag；7 项必要目标变量及 `RAILWAY_API_TOKEN`、`NEON_API_KEY`、`RELEASE_DATABASE_URL` 三项 secrets 已配置，真实生产只读预检通过。
- [x] `v*` tag 创建 ruleset 和禁止更新/删除 ruleset 已启用。
- [x] 已实测普通 push 只运行 CI：run `39383174686` 成功，Railway 两个服务 deployment 未变化。
- [x] release workflow 已实现版本与提交校验、单次镜像构建、按需 snapshot、兼容迁移、API/worker 部署验证和脱敏失败结果；迁移清单只允许经 SHA 审核的向后兼容迁移。
- [ ] GHCR 的 `agrid` package 尚未初始化，也未完成匿名拉取验证。普通匿名 registry 请求返回 403；0099 的 `ghcr-bootstrap.yml` 实现当前处于 review，尚待审查并合入 `master`。它使用 job 的 `GITHUB_TOKEN` 初始化镜像，不需要个人 `packages` PAT；之后仍需管理员手动将 GHCR package 设为 Public 并验证匿名拉取。
- [ ] `RELEASE_BOOTSTRAP_READY=false`，不能创建或推送生产版本 tag，不能称发布入口已经启用。
- [ ] snapshot 配额尚待核验。当前没有 pending migration，因此尚未真实演练 snapshot 创建与迁移；也未做真实生产 tag 发布、生产镜像部署或发布后冒烟。

细节与证据见 `.herdr/reports/0099-release-activation/progress.md`、`github-settings.json`、`ordinary-push-proof.json`、`project-token-status.json`。状态以这些记录中最新的实际结果为准。完整操作指南见 [`docs/releases.md`](docs/releases.md)。

## 目标流程

日常开发：

feature 分支 → 本地验证 → PR review / CI → 合并 master；全程不触发生产发布。

生产发布：

人工确认版本 → 推送受保护的 `vX.Y.Z` tag → 校验 tag 对应提交并构建制品 → 如需迁移则创建并验证 Neon snapshot → 执行兼容迁移 → 把同一镜像 digest 部署到 API 与 worker → 健康检查和只读冒烟 → 记录结果。

版本 tag 是对该版本的发布授权，GitHub Environment 的额外审批可选，不应默认要求重复批准。agent 不得自行创建或推送生产 tag。启用前的配置、一次性 GHCR 初始化、失败恢复和 tag 示例以[生产发布指南](docs/releases.md)为准。

## 剩余启用条件

- [x] 关闭 Railway 普通 `master` push 的应用自动部署，并确认 IaC 不会重新启用该触发器。
- [x] 保留普通 CI，生产 workflow 仅接受正式版本 tag。
- [x] 配置人工确认边界、Environment tag 来源限制和 `v*` tag 创建/不可变规则。
- [x] 配齐生产凭证与目标变量，并通过 Railway/Neon 生产目标真实只读预检。
- [x] 发布 workflow 校验 tag 和提交来源，构建一次制品，并让 API 与 worker 使用同一镜像 digest。
- [x] 实现按需 snapshot、允许迁移校验、应用部署和失败状态报告；真实迁移发布演练尚未完成。
- [x] 普通 push 未触发 Railway 发布的远端证据已取得。
- [ ] 完成 GHCR bootstrap、切换 package 为 Public 并验证匿名 digest 拉取。
- [ ] 完成 GHCR 初始化、Public 设置和匿名 digest 拉取；核对 snapshot 配额及保留策略，待所有前置配置和验证通过后才将 `RELEASE_BOOTSTRAP_READY` 设为 `true`。
- [ ] 获得具体版本、SHA 与变更清单的人工确认后，才进行首次生产 tag 发布。

在尚未完成的远端条件关闭前，保持 `RELEASE_BOOTSTRAP_READY=false`。不得用测试环境或个人 PAT 代替正式生产凭证，也不得删除最后一个可恢复 snapshot 腾空间。
