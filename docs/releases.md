# 生产发布

本文说明 tabdo 的分支开发与 Railway 生产发布流程。生产发布的人工确认点是把准备发布的更改合并到 `master`；普通开发、提交到 `develop` 和 CI 通过都不会发布生产版本。

## 分支与职责

- `feature` 分支用于独立开发。完成后合并到 `develop`，由日常 CI 检查。
- `develop` 是日常集成分支。它不连接 Railway 生产部署，也不触发生产迁移。
- `master` 是生产分支。只有在人工确认发布后，才将准备好的 `develop` 更改合并到 `master`。
- 执行普通开发任务的代理不得直接推送 `master`，也不得自行把更改合并到 `master`。发布者须明确确认本次发布后再完成合并。

版本 tag 不作为发布门禁或发布触发器。无需创建 tag，也不需要手工运行部署命令、上传源代码或调用部署 API。GitHub Actions 负责 CI，不持有生产 Railway、数据库或 Neon 管理凭证。

## 自动发布流程

1. 开发者将 feature 分支合并到 `develop`。GitHub Actions 运行日常 CI；这个步骤不部署生产。
2. 发布者检查 `develop` 中准备发布的更改，并人工确认是否发布。确认后，将这些更改合并到 `master`。
3. GitHub Actions 对 `master` 提交运行 CI。Railway 的 GitHub 集成连接 `boyd4y/agrid` 仓库的 `master` 分支，启用自动部署和等待 CI/check suites；检查通过后，Railway 拉取 `master`，使用 `Dockerfile.server` 构建并自动部署 API 与 worker。
4. API 的 Railway `preDeploy` 在新 API 进程启动前检查数据库迁移状态。没有待迁移内容时跳过备份与迁移；有待迁移内容时，按已审核的兼容性与 SQL hash 规则创建并验证 Neon snapshot，再运行现有 migrator 并复查迁移账本。迁移失败时部署应失败，不会自动恢复数据库。
5. API 与 worker 是两个独立的 Railway 服务。GitHub push 会分别触发部署，不能保证 API 一定先于 worker。API 的 `preDeploy` 命令为 `node /app/scripts/release/predeploy.mjs`；worker 使用只读的等待模式 `node /app/scripts/release/predeploy.mjs --wait`，在 ledger 显示没有待迁移内容前不放行。该模式不创建 snapshot、不执行迁移，也不使用 Neon 管理密钥。两项 `preDeployTimeoutSeconds` 均为 1200 秒；脚本自身的总等待上限为 1080 秒。

等待 CI 只表示 Railway 等待关联检查结束；CI 失败时 Railway 不应继续部署。普通 `develop` push 不连接生产部署。

## 配置要求

Railway 的 API 和 worker 服务均应连接 `boyd4y/agrid` 的 `master`，开启自动部署和 **Wait for CI/checkSuites**，并使用仓库根目录的 `Dockerfile.server`。两个服务分别部署，服务间的环境变量引用不能保证部署顺序；worker 的只读迁移等待检查负责阻止它在数据库迁移完成前启动。

生产环境变量和秘密保存在 Railway。GitHub Actions 只运行 CI，不配置生产 Environment、部署 token、生产数据库连接串或 Neon 管理密钥。API 服务单独保存 `NEON_API_KEY`、`NEON_PROJECT_ID`、`NEON_BRANCH_ID` 和 `RELEASE_RAILWAY_PROJECT_ID`、`RELEASE_RAILWAY_ENVIRONMENT_ID`、`RELEASE_RAILWAY_API_SERVICE_ID`；这些值用于 API `preDeploy` 校验目标并按需创建 snapshot。worker 不配置这些 Neon 管理变量。数据库运行连接仍由 Railway 服务环境提供。本地开发继续使用 `.env.development` 与本地/隔离测试资源，不读取生产配置。

开发或测试不得通过生产凭证访问生产数据库。集成测试使用以 `_agent_test` 结尾的独立数据库；队列测试使用独立 `_queue_test` 数据库、隔离 Redis 和 `agrid-queue-test` 前缀。

## 当前验证状态

双分支与 Railway 原生部署方案已经确定；端到端生产流程仍待完成实测。尚未完成实测前，不要描述为已成功发布或已验证生产迁移。待实测项目包括：

- feature → `develop` 的 CI 检查不会触发 Railway 生产部署。
- 人工确认后合并到 `master`，GitHub CI 与 Railway 的等待关系符合预期。
- Railway 使用 `Dockerfile.server` 自动构建并部署 API、worker。
- 有待迁移内容时 API `preDeploy` 完成 snapshot、兼容性/hash 校验、迁移和账本复查；没有待迁移内容时跳过 snapshot 和 migrator。
- worker 的只读 `preDeploy` 在迁移完成后放行；迁移失败或超时会阻止 worker 新版本启动。
- API/worker 独立部署期间，用户可见服务状态与健康检查符合预期。

## 失败处理

Railway 部署或检查失败时，先在 Railway 查看 API 与 worker 各自的 deployment 状态和日志，以及 API 的 `/api/health`。迁移失败时不要手工重复执行迁移，也不要用旧版本覆盖数据库；核对 Neon snapshot、迁移账本和实际数据库状态后，再制定恢复方案。服务回退不会撤销已经成功的数据库迁移，也不会恢复迁移后的数据。

如果 API 迁移尚未完成或失败，worker 的只读等待检查应保持失败，避免新 worker 使用未完成的 schema。不要绕过检查强行启动 worker。需要数据库恢复、破坏性迁移或修改生产 Railway 配置时，由有权限的维护者先评估影响并确认操作。

开发环境、隔离测试和生产环境必须分开。不得把生产连接串、密钥或 token 写入仓库、CI 日志或提交内容。
