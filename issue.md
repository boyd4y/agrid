# 开发与生产发布流程问题

按用户 2026-10-20 的最终决定维护：本地必要检查和独立 review 后进行日常集成；人工确认发布时将准备好的更改合并到 `master`；Railway 通过原生 GitHub 集成直接构建并部署，不依赖 GitHub Actions 或云端 CI。版本 tag、GHCR、源码上传和自定义部署 API 编排均不属于此方案。

## 目标流程

- feature → `develop`：本地必要检查和独立 review 后进行日常集成；不触发生产部署。开发和集成使用本地 `.env.development` 与隔离测试资源。
- 人工确认将准备好的更改合并到 `master`：这是生产发布动作。普通开发代理不得直接推送 `master`。
- Railway 的 API 与 worker 服务各自连接 `boyd4y/agrid` 的 `master`，设置 `checkSuites=false`，并用 `Dockerfile.server` 自动构建和部署。
- API `preDeploy` 仅在有 pending migration 时按兼容性/hash 审批执行 snapshot、现有 migrator 和账本复查；无 pending 时跳过备份与迁移。worker 的 `preDeploy` 只读等待迁移完成，不备份、不迁移、不使用 Neon 管理密钥。

API 和 worker 是两个独立的 Railway 部署，平台不保证其先后顺序；不能依赖服务变量引用实现排序。迁移须与仍在运行的旧实例兼容。生产运行变量和秘密存放于 Railway。

## 尚待端到端实测

双分支发布方案已确定，但生产流程端到端实测仍待完成。逐项记录结果后再标记完成：

- [ ] 确认 feature → `develop` 的日常集成不会触发 Railway 生产 deployment。
- [ ] 确认人工发布合并到 `master` 后，Railway 原生集成不等待 CI/check suites 并启动部署。
- [ ] 确认 API 和 worker 均从 `boyd4y/agrid` 的 `master` 以 `Dockerfile.server` 成功构建、部署；分别记录 deployment 状态和健康检查。
- [ ] 在隔离/可控验证条件下核验 API 无 pending migration 时不创建 snapshot、不运行 migrator。
- [ ] 核验有 pending migration 时 API 先校验审批与 hash、创建并读回 snapshot，再运行现有 migrator 并复查账本；失败时 API deployment 失败且不自动恢复数据库。
- [ ] 核验 worker 的只读等待检查在迁移完成前不放行，完成后放行；API 迁移失败或等待超时会阻止 worker 新版本启动。
- [ ] 确认 API 与 worker 分别部署的过程中，不依赖固定部署顺序或服务变量引用。

实测完成前不得声称生产发布、迁移或部署验证成功。详见[生产发布指南](docs/releases.md)和[Railway 部署说明](docs/railway.md)。
