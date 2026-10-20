# 生产发布

本文说明生产版本的确认方式、自动发布流程和异常处理。普通开发、测试、提交、合并与 CI 不需要生产凭证，也不会作为生产发布确认。

## 发布确认

生产发布以人工确认的正式版本 tag 为准，格式为 `vX.Y.Z`，例如 `v1.2.3`。确认该版本并创建、推送 tag，即表示批准发布这个版本。无需再为同一次发布默认执行第二次 GitHub 环境审批；管理员可以按团队需要另外启用 GitHub Environment 审批，作为额外保护。

建议按 `feature branch → pull request → master → version tag` 发布。工作流 [`release.yml`](../.github/workflows/release.yml) 只监听 `v*` tag push，并拒绝非新建、被强推、格式不符或不在 `master` 祖先上的 tag，也会固定 tag 原始对象，拒绝重绑。新流程启用后，普通分支 push、pull request、master 合并或 CI 通过只运行日常 CI，不触发 tag 发布。在管理员关闭 API 和 worker 上现有的 Railway `master` 自动部署之前，master 更新仍可能直接触发生产部署；完成关闭前不要认为生产入口已经安全切换。

在发布入口尚未启用前，不要创建或推送生产 tag。当前仓库的发布配置与自动化正在准备中，远端尚未完成一次性启用，不能把 tag 推送当作现成的生产发布通道。

## 首次启用（管理员一次性操作）

发布流程准备好后，由仓库/平台管理员完成下列配置。配置完成后，日常发布者只需确认版本并发布 tag，不需要手工备份数据库、运行迁移或执行 Railway 命令。

1. 在 GitHub 的 `tabdo / production` Environment 中设置 secrets：`RAILWAY_API_TOKEN`、`NEON_API_KEY`、`RELEASE_DATABASE_URL`。`RAILWAY_API_TOKEN` 必须是目标 Railway 项目的目标 environment 级 Project token；发布脚本使用 `Project-Access-Token`，并查询 token 作用域。不要提供 account/workspace token 或扩大到账号级权限。`NEON_API_KEY` 应限于目标 Neon project 可用的管理权限。`RELEASE_DATABASE_URL` 必须是该 Neon 生产分支的 PostgreSQL 直连地址（不是 `-pooler`），使用 `sslmode=require`，并能读迁移 ledger/schema 和执行项目 migrator 所需 DDL。不要将这些值放入 repository variables、日志或提交内容。

   同一 Environment 的 **Deployment branches and tags** 也必须限制来源：进入 GitHub 仓库 **Settings → Environments → `tabdo / production`**，选择 **Selected branches and tags**，只添加 **Ref type: Tag、Name pattern: `v*`** 规则，删除全部 Branch 规则和其它允许模式。不要选择 **No restriction** 或 **Protected branches only**。这样普通分支和 pull request workflow 不能使用此 Environment 的 secrets。tag ruleset 不替代这项 Environment 限制；此处无需配置 Required reviewers 或增加第二次 Approve，人工确认并推送正式版本 tag 仍是发布授权。可参阅 [GitHub Environment 部署来源限制](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags)。
2. 在同一 Environment 中设置项目变量：`RAILWAY_PROJECT_ID`、`RAILWAY_ENVIRONMENT_ID`、`RAILWAY_API_SERVICE_ID`、`RAILWAY_WORKER_SERVICE_ID`、`NEON_PROJECT_ID`、`NEON_BRANCH_ID`、`RELEASE_PUBLIC_URL`。这些 ID 和 URL 必须指向预期的生产资源；公开地址必须是无路径、query、凭证的 HTTPS origin。管理员应核对两个 Railway 服务的 `DATABASE_URL` / `DATABASE_URL_UNPOOLED` 指向与 `RELEASE_DATABASE_URL` 相同的数据库，并确认 API `APP_URL` / `BETTER_AUTH_URL` 与 `RELEASE_PUBLIC_URL` 一致，`NODE_ENV=production`、`TABDO_ENV=production`、`AUTH_REQUIRED=true`、`QUEUE_PREFIX=tabdo-production`。ID 不能依赖开发者本机 Railway CLI 的 link 状态。
3. 确认 GitHub Container Registry 中的 `ghcr.io/boyd4y/agrid` 包存在且设为公开。目前包是否存在、是否公开尚未核实。若包不存在，管理员可从已经确认的源码提交一次性构建并推送镜像；首次 push 会创建 GHCR 包。这个初始化只准备镜像，不会部署服务；在完成其余配置和验证前，`RELEASE_BOOTSTRAP_READY` 必须保持 `false`，不要创建生产版本 tag。

   在项目根目录的 Bash/Zsh 中执行以下命令。先把 `SOURCE_COMMIT` 替换为已确认、已合入 master 的完整 commit SHA。脚本以 `set -Eeuo pipefail` 遇错即停，在临时全新 clone 中核对 SHA、master 祖先关系和干净状态；任一检查、登录或 builder 创建失败都会在 push 前终止。Docker 凭证也写入临时隔离目录并在退出时清除。使用仅具备 `write:packages` 权限的 GitHub token；从密码管理器注入环境变量，不要把 token 写入命令行参数或 shell 历史。`bootstrap-sha-...` tag 专用于初始化，正常发布 workflow 使用另一个 `sha-...` tag；生产部署使用构建输出的 digest，不使用可变 tag。

   ```sh
   set -Eeuo pipefail
   BUILD_ROOT=$(mktemp -d "$PWD/.ghcr-bootstrap.XXXXXX")
   BUILD_DIR="$BUILD_ROOT/source"
   DOCKER_CONFIG="$BUILD_ROOT/docker"
   export DOCKER_CONFIG
   export BUILD_ROOT
   cleanup() {
     release_exit_code=$?
     trap - EXIT
     docker logout ghcr.io >/dev/null 2>&1 || true
     python3 -c 'import os, shutil; shutil.rmtree(os.environ["BUILD_ROOT"], ignore_errors=True)' || true
     exit "$release_exit_code"
   }
   trap cleanup EXIT
   git clone https://github.com/boyd4y/agrid.git "$BUILD_DIR"
   cd "$BUILD_DIR"
   git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master
   SOURCE_COMMIT=replace-with-confirmed-commit-sha
   [[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
   git merge-base --is-ancestor "$SOURCE_COMMIT" refs/remotes/origin/master
   git switch --detach "$SOURCE_COMMIT"
   test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
   test -z "$(git status --porcelain --untracked-files=all)"
   SOURCE_SHA=$(git rev-parse HEAD)
   printf '%s' "$GHCR_WRITE_PACKAGES_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
   docker buildx create --use
   docker buildx build --platform linux/amd64 --provenance=false \
     --label "org.opencontainers.image.revision=$SOURCE_SHA" \
     --label "org.opencontainers.image.source=https://github.com/boyd4y/agrid" \
     --tag "ghcr.io/boyd4y/agrid:bootstrap-sha-${SOURCE_SHA}" \
     --file Dockerfile.server --push .
   ```

   推送后，在 GitHub 仓库的 Packages 中打开 `agrid` 包设置，将可见性设为 **Public**。在没有 GHCR 登录凭证的干净环境中，执行 `docker pull ghcr.io/boyd4y/agrid:bootstrap-sha-<完整源码 SHA>` 验证该 tag 可匿名拉取。只对已确认且预期发布的源码执行这一次性初始化；不要把生产环境变量或 secret 注入构建。若包已存在，则先核实其所有者、内容和可见性，不要覆盖已有 tag。新 package 默认可能为 private；仓库公开不代表 package 公开。
4. 在 Railway 中一次性停用 API 与 worker 服务对 `master` 的 GitHub 自动部署和 image auto updates，清空 API 旧 `preDeploy` 迁移 hook，避免绕开 tag 发布流程或重复运行迁移。确认环境没有指向这两个服务的 GitHub deployment triggers，两个 service source 均不再包含 GitHub repo；API 与 worker 各自只有一个 `SUCCESS` active deployment，且它与 latest deployment 相同，没有 queued/pending deployment。确认 API start 为 `node dist/index.js`、healthcheck 为 `/api/health`，worker start 为 `node dist/queue/main.js`。这些是 workflow 的上线前置条件。发布后由工作流将同一个不可变镜像 digest 部署到两个服务。
5. 为 `v*` 创建并启用 GitHub tag ruleset。创建规则与不可变规则分开设置：创建规则启用 **Restrict creations**，绕过名单只加入指定版本发布者；不可变规则启用 **Restrict updates** 和 **Restrict deletions**，不添加绕过者，使已发布版本 tag 不能被重绑或删除。若确有紧急修正，需要管理员临时变更规则并保留审计记录，完成后恢复保护。上述 ruleset 需由管理员实际创建并设为 Active；本轮未配置。可参考 [GitHub ruleset 规则说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)。
6. 核对 Neon snapshot 配额和保留策略，确保按 7 天保留期及预计发布频次有足够空间。此前已遇到原生 snapshot 配额限制；工作流在 quota 不足、snapshot 创建或读回校验失败时会在迁移与部署之前停止。它不会删除其他 snapshot，也不会删掉最后恢复点来腾空间。由管理员处理配额后，再决定何时继续。
7. 按仓库中的发布配置完成预检，并在上述设置全部验证通过后（包括 `tabdo / production` Environment 只允许 `v*` tag 来源），将仓库变量 `RELEASE_BOOTSTRAP_READY` 设为 `true`。未设置或不是 `true` 时，发布必须停止。此开关只表示一次性启用检查已完成，不代替版本 tag 确认。

0097 的冻结记录显示 Environment secrets 尚未设置，GitHub repository 与 Environment 当前没有 secrets，也没有已配置 rulesets；发布 bootstrap 尚未完成。当前 GHCR package 是否存在、是否公开也尚未核实。本轮不会设置远端 secrets/variables、创建 tag ruleset、修改 Railway 设置、初始化 GHCR 包或执行真实生产操作。不要仅因仓库中有 workflow 或配置名，就推断发布入口已启用。

## 一次正常发布

启用完成后，发布者确认待发布的 `master` 提交和版本号，再创建并推送对应的正式 tag。示意命令如下；将版本号替换为已确认的版本：

```sh
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

tag 推送后，专用发布工作流按 [`release.yml`](../.github/workflows/release.yml) 执行：先验证正式版本 tag 与 master 祖先关系，再调用无生产凭证的 reusable CI [`checks.yml`](../.github/workflows/checks.yml)，构建一次 linux/amd64 GHCR 镜像，最后才进入 `tabdo / production` Environment。构建 job 仅有 GHCR `packages:write` 权限；production credentials 不会进入 CI 或 image build。生产 job 自动校验配置和实际目标、镜像匿名可读性、tag 与 digest、服务设置和现有健康状态；需要迁移时先创建并独立读回 Neon snapshot，再用已构建的同一个镜像运行一次迁移，之后顺序部署 API 和 worker 到相同 digest，并校验 Railway SUCCESS、精确 deployment、API schema health 和只读公开 smoke。平台状态轮询最多 60 次、每次间隔 5 秒；超时会报告结果不确定，不重复请求有副作用的变更。全流程串行运行且不会取消正在执行的发布。工作流记录版本、提交 SHA、digest、部署标识及可用的恢复点标识；发布者无需另外运行备份、迁移或 Railway 命令。实际生产入口为 [`node scripts/release/run.mjs`](../scripts/release/run.mjs)，只由 workflow 调用。

没有 pending migration 时，工作流不创建 snapshot，也不运行 migrator。正常自动发布只接受经过 hash 审核并登记在 [`migrations.json`](../scripts/release/migrations.json) 的向后兼容迁移，且 `requiresWriterDrain` 必须为 `false`。清单默认为空。每个待执行迁移的 key 使用 migration journal 中的 tag，并记录该 SQL 文件的真实 SHA-256。以下为结构示意，必须先把 hash 占位符换成实际 64 位小写 SHA-256 才能作为有效清单：

```json
{
  "0034_example": {
    "sha256": "<该 SQL 文件的 SHA-256>",
    "compatibility": "backward-compatible",
    "requiresWriterDrain": false
  }
}
```

可用 `shasum -a 256 apps/server/drizzle/0034_example.sql` 计算文件 hash，再由评审者确认兼容性后登记。清单不是 SQL 自动安全分析，且只允许 journal index 大于 5 的待执行迁移；早期迁移、历史 schema 修复都需要独立方案。未知迁移账本、账本缺口、未登记迁移、破坏性迁移或需要 writer drain 的变更都会停止。若旧数据修复开关 `MIGRATION_ALLOW_ORPHAN_DELETE` 或 `MIGRATION_ORPHAN_ORG_ID` 存在，也会在生产目标预检中拒绝。

## 检查与日常开发

本地开发继续使用本地环境和隔离测试资源。发布编排的安全验证命令为 `pnpm test:release`，使用 mock，不访问数据库、Redis、生产平台或真实镜像；tag workflow 另行运行 build、typecheck 和约定的测试。没有本地 release dry-run 或本地 deploy 模式。不要本地调用 [`scripts/release/run.mjs`](../scripts/release/run.mjs)，不要以真实生产凭证测试，也不要创建 tag 来验证 workflow。

GitHub Environment 可配置可选 required reviewers 等平台保护规则。它们属于团队可选的附加审批；本流程以人工确认并发布正式版本 tag 作为发布授权，不要求同一版本再重复批准。

## 失败与恢复

发布失败后，在 GitHub Actions 该次运行中下载保留 30 天的 `release-result-<run_id>-<run_attempt>` artifact，检查 `.release/result.json` 中的 `status`、`stage`、错误码、旧/新 deployment ID、pending migration tags 和 backup ID。结果经过脱敏，不包含连接串、平台原始错误或 migration stdout。不要尝试从常规 workflow log 中恢复被抑制的敏感信息。

- `failed_before_application_deploy`：脚本报告尚未开始应用部署。若异常发生在 mutation 请求期间或结果 ID 缺失，仍须在 Railway 检查实际状态；请求超时不代表平台没有接受操作。
- `manual_recovery_required`：迁移已开始，或至少一个应用 source/deploy 操作已尝试。工作流不会自动回退应用，也不会自动恢复数据库；按下方流程由有权限的管理员单独评估和恢复。
- Neon snapshot 配额不足、创建/校验失败，或 migration plan 不兼容：流程不会执行迁移或进入应用部署。管理员应在 Neon 核对配额、snapshots 和 operations，再决定如何继续。snapshot 保留 7 天，需预留覆盖预期发布频次的空间；流程不会自动删除其他备份或最后恢复点。若 snapshot 创建请求的响应丢失，应核对 Neon snapshots/operations；可能已创建的恢复点 ID 会在结果 artifact 中保留（若已读到）。不要盲目重发副作用请求。
- migration 失败：不会开始应用部署，但状态为 `manual_recovery_required`。迁移容器有 5 分钟上限；检查 Neon、ledger 和数据库实际状态，再确定单独恢复方案。不能自动恢复旧 snapshot 覆盖新写入。

### 手动恢复应用

只有取得单独的人为恢复授权后才进行恢复。发布失败且需要回退时：

1. 下载该次 `release-result-...` artifact，按 `previous[]` 找到每个服务的旧 `deploymentId`，并查看 `deployments[]` 中本次创建/尝试的 ID。检查 Railway 当前 service source、latest/active deployment，排除仍会继续推进的 queued/pending 请求。平台响应丢失时，ID 可能未知；先在 Railway 控制台核对，不能仅凭脚本超时判断平台已经停止。
2. 对相应旧 deployment ID 查询是否仍可回滚：

   ```graphql
   query Check($id: String!) {
     deployment(id: $id) { id status canRollback meta }
   }
   ```

   请求地址为 `https://backboard.railway.com/graphql/v2`，认证使用目标 project/environment 的 `Project-Access-Token`。token 应通过安全的 API 客户端注入 header，不要写入命令、日志或 artifact。不可改用 account/workspace token。
3. 仅当结果 `canRollback` 为 `true`、旧镜像与现有数据库 schema 兼容、且确认该旧 deployment 不会再次执行迁移 hook 时才继续。冻结契约要求初始化时清空 API 的旧 `preDeploy` hook；管理员仍须核实恢复目标的历史配置。
4. 在恢复授权和检查均通过后，对旧 deployment ID 调用 Railway rollback mutation：

   ```graphql
   mutation Rollback($id: String!) {
     deploymentRollback(id: $id) { id status }
   }
   ```

   记录 mutation 返回的新 deployment ID；不要重试没有明确响应的 rollback 请求。通过同一个 project/environment token 查询这个精确的新 ID，等待 `SUCCESS`，并核对 service/project/environment、部署 `meta.image` digest、当前 active deployment 以及 API `/api/health` 的 schema 状态。分别检查 API 与 worker，确认它们处于有意选择的已知版本；若要求同版本运行，digest 必须一致。
5. 若权限不足、旧 deployment 已超出保留期、迁移兼容性不明确、旧 hook 无法排除、mutation 返回不明或状态不一致，立即停止自动操作，由管理员在 Railway 控制台检查并制定恢复计划。

应用镜像回退不会撤销已经成功的数据库迁移，也不会恢复迁移后的数据。发布流程不会自动把生产数据库恢复到旧时间点，以免删除新写入。数据库恢复、破坏性迁移或 writer drain 必须另获授权并制定独立方案；Neon snapshot 是恢复资料，不是自动回滚。

不要删除、强推或重绑已发布 tag。若 GHCR package 首次由正常 release workflow 创建且默认是 private，匿名镜像预检会报 `image_not_anonymously_pullable_make_ghcr_package_public` 并在服务变更前停止；管理员可将包设为 Public，然后在原失败的 GitHub Actions run 上选择 **Re-run jobs**，不必重绑 tag。其他一次性配置错误也应先核实其副作用是否发生，再决定是否重跑。若代码需要修改，走正常变更、合并，再由人确认并创建新的版本 tag。tag 创建限制由仓库 `v*` rulesets enforce。

## 官方参考

- [GitHub Actions：部署到环境](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment)
- [GitHub Actions：环境与部署保护](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GitHub：可用的 ruleset 规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Railway：控制 GitHub 自动部署](https://docs.railway.com/deployments/github-autodeploys)
- [Railway API：身份验证与 token](https://docs.railway.com/integrations/api)
- [Railway API：管理服务](https://docs.railway.com/integrations/api/manage-services)
- [Railway API：管理部署与回滚](https://docs.railway.com/integrations/api/manage-deployments)
- [Railway IaC 配置参考](https://docs.railway.com/infrastructure-as-code/reference)
- [Railway：从容器注册表部署](https://docs.railway.com/guides/private-container-registry)
- [Neon API：创建 snapshot](https://api-docs.neon.tech/reference/createsnapshot)
- [发布编排入口](../scripts/release/run.mjs)、[tag 与提交校验](../scripts/release/git.mjs)、[迁移计划校验](../scripts/release/database.mjs)
