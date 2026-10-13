# 测试与浏览器回归

测试与源码按包平级：`server/test/{ai,commands,queue,reports,skills,harness,routes}`、`shared/test`、`client/test`。生产 TypeScript 只编译 `src`；server/shared 构建先清理 `dist`，避免旧编译测试残留。server/shared 的 `tsconfig.test.json` 单独覆盖测试和其源码导入，检查时不输出文件。

## 常规检查

```bash
pnpm typecheck
pnpm typecheck:test
pnpm --filter @tabdo/shared test
pnpm --filter @tabdo/client test
# 数据库须独立、已迁移，名称以 _agent_test 结尾
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm test
pnpm build
```

server 常规入口覆盖 AI 错误、关联、报告/独立自动化、Skill、原生 Harness 和 chat API。仍保留 `test:chat`、`test:relations`、`test:reports`、`test:skills`、`test:harness` 各业务入口。`test:queue` 单独运行，因为它要求专用队列数据库和 Redis，不能与其他用例共用存储。

`server/test/harness/skills-bundle.test.ts` 无数据库依赖，读取生产四个内置 bundle，使用真实官方 Pi native read/bash 验证按需加载完整文档、引用和脚本。它还将四包工作区快照恢复为仅分配 form 的新实例，验证 SDK 删除 report 挂载并拒绝旧脚本读取。本地 Python 探测实际返回不支持（exit 127），没有将宿主 Python 或成功读取脚本记作原生脚本执行成功。单独运行：

```bash
pnpm --filter @tabdo/server exec tsx --test test/harness/skills-bundle.test.ts
```

## 显式启用的真实 Sandbox 验收

`server/test/harness/remote-smoke.ts` 不在常规测试的 `*.test.ts` 范围内。它需要 `VERCEL_TOKEN`、`VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID` 三项完整配置，或有效 `VERCEL_OIDC_TOKEN`。凭证通过环境或仓库 `.env` 读取，脚本不输出凭证值。先检查配置，再显式启用真实资源创建：

```bash
pnpm --filter @tabdo/server test:harness:remote -- --preflight
HARNESS_REMOTE_SMOKE=1 pnpm --filter @tabdo/server test:harness:remote
```

缺少凭证或未启用时退出码为 2，并明确输出 BLOCKED；preflight 只检查配置存在，不能证明凭证有效，也不算远程验收通过。实际执行使用官方 `createNativeAgent` / `openNativeSandbox` 创建独立 UUID 的 Pi + Vercel Sandbox；复用生产 builtin loader 挂载真实 report bundle，原生 read 按需读取 AGENTS、完整 SKILL.md、metrics reference 和 `scripts/summarize-csv.py`，原生 write 写独立 fixture CSV，再由原生 bash 执行 `python3 ... --group category --metric sum --value amount`。模型收到的真实 JSON 和远程输出文件都需满足求和、空值、负数与行数断言。

随后 `session.stop()`、`sandbox.stop()`，通过官方 resume lookup 恢复同一 Sandbox，在新 turn 只读核对原生历史、CSV、生产脚本、输出文件和执行计数仍为一；输出字节保持不变，不再执行 Python。验收沿用产品的 node24 模板，先探测真实远程 `python3`；缺失则明确以失败退出，不安装任何宿主或远程包，也不把另一执行环境的能力计入产品验收。它不伪造 Sandbox，也不把普通本地执行计为远程成功。

Pi 是 host runtime，因此模型由宿主本地 HTTP fixture 确定性响应，不需要远程 Sandbox 访问本地模型端点，不使用 OpenRouter 或其他付费模型。测试不导入应用数据库、不写业务数据、不启动或重启应用 API。实际远程 Sandbox 仍使用 Vercel 资源，脚本在 finally 中销毁自己创建的 Sandbox 和原生会话；清理失败也按失败退出并打印需要清理的测试资源 ID。只有实际创建、工具执行、停止恢复、历史/文件检查及清理全部通过才输出 PASS。

当前本机缺少 Vercel 凭证：测试类型检查已通过，preflight 明确以 2 退出；真实远程验收仍待配置，不能记为完成。生产 Python 脚本使用同一 CSV 和参数在宿主做过窄契约验证，JSON 符合期待；这不证明原生 Sandbox 具备 Python，也不计为远程通过。官方接口依据：[HarnessAgent 会话恢复](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)、[Pi host runtime adapter](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)。

## 实际浏览器回归

`server/test/harness/startup-boundary.test.ts` 使用独立 `*_agent_test` 数据库和真实 HarnessAgent/Pi、本地 HTTP provider。它断言尚未调用 turn 的真实 SDK stop 可返回空状态，而应用不会覆盖旧 resume/workspace；首轮失败与取消后的新输入、已有会话的启动前失败/停止、未完成 session 的错误输入与官方继续均不重放已提交工具。客户端伪造未执行证明和旧空状态仍拒绝恢复。它只证明明确未调用 Pi invocation 的边界，不证明进程崩溃后的自动重放安全。

先启动已有前端（默认 `http://localhost:5173`），安装本地 Chrome 或执行 `pnpm --filter @tabdo/client exec playwright install chromium` 后设置 `BROWSER_CHANNEL=bundled`。浏览器脚本自行启动测试 API，默认端口 `3112`；API 与页面请求使用指定的独立数据库，并路由页面 `/api` 请求至测试 API。它不会重启正在运行的 `3001` API 或前端。测试只清理自身新建的工作区和账号。

```bash
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm test:browser
# 只跑某个已归档 suite：
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm --filter @tabdo/client test:browser builders
```

- `builders`：独立自动化新建/编辑/运行记录/删除与取消/旧路由；表单共用 BuilderLayout 和真实字段设置保存；视图菜单键盘/Escape/删除；Dashboard 连续拖拽/缩放的 light/dark 逐帧反馈、边缘、保存恢复及窄屏。
- `views`：重命名取消/Escape/Enter，唯一默认视图加载与星标、每视图显示字段顺序/空值/宽松精简保存恢复，卡片固定Header/Content/Footer与人员日期，记录Sheet真实编辑/数字校验/保存/冲突保留/取消、计算字段只读/关联栈返回、checkbox保存、独立拖拽手柄不开Sheet，单操作菜单图标/置顶持久化/删除取消，宽屏AI并存和窄屏快捷键切换保留草稿；外部点击/Escape关闭并丢弃草稿、真实保存进行中阻止关闭、AI外部按钮正常dismiss、关联Popover portal交互。
- `fields`：字段图标、HEX 校验/持久化、下拉颜色、取消、dark/light、报告汇总 Popover 不改变组件几何尺寸。
- `run-recovery`：原始流请求在刷新时真实断开，服务端仍执行；持久化运行状态禁发、完成消息原位恢复、显式停止、官方 continuation 和消息内失败反馈；确认聊天没有执行历史入口。
- `avatars`：本地 Notionists/Croodles 选择、批次与主题，成员头像暂存/取消/失败/保存恢复，bot 专用 bloub 配置与禁止上传，创建草稿及紧凑高度按钮可达。
- `agent-tools`：三步创建与编辑左侧工具 Tab；native/platform 缺省开启、真实 API 保存/取消/刷新恢复、跨步骤和 Tab 草稿保留、搜索/目录错误重试、light/dark 和窄屏。主题截图等待输入颜色过渡完成，避免截到切换中间帧。
- `platform-style`：Settings、Skill 列表/详情、Reports 列表/Builder、Automations 列表/来源选择的紧凑 light/dark 截图；有记录的报告刷新失败和自动化失败重试；Skill 文件选择、复制失败反馈与真实剪贴板；主题单选和侧栏偏好刷新恢复。
- `kanban-drag`：整卡标题/正文的原生浏览器拖拽，Sheet 打开/关闭前后真实 PATCH 与状态持久化、无误开详情；卡片菜单控件不触发行拖拽；统一删除确认的取消/失败 toast/重试/删除刷新恢复。API 通知会刷新看板列，动作先等待数据稳定，再定位当前语义标题/正文，不依赖合成 drag 事件或过期卡片坐标。

新增 browser suite 放 `client/test/browser/*.mjs`，复用 `fixture.mjs`；默认入口自动发现 suite 并串行执行。`fixture.mjs` 提供本地 provider metadata，涉及模型执行的 suite 通过 `modelRequest` 提供 HTTP fixture，不连接真实供应商。

可配置 `BROWSER_BASE_URL`、`BROWSER_API_PORT`、`BROWSER_CHANNEL`、`BROWSER_EXECUTABLE_PATH`、`BROWSER_ARTIFACT_DIR`。默认截图、API 日志与 Dashboard 帧轨迹写入被 git 忽略的 `client/test/artifacts/<运行时间>/`，无用户绝对路径或 `/tmp` 文件依赖。

## 队列进程与 Redis 故障测试

专用 PostgreSQL 数据库名称必须以 `_queue_test` 结尾，并先执行迁移；Redis 使用专用实例与 `agrid-queue-test` 前缀。下面使用本地已有测试实例，绝不能改成业务数据库/Redis：

```bash
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/agrid_atomic_queue_test pnpm --filter @tabdo/server db:migrate
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/agrid_atomic_queue_test \
REDIS_URL=redis://127.0.0.1:6381 QUEUE_PREFIX=agrid-queue-test-regression \
AUTOMATION_LEASE_MS=1000 WORKER_LOCK_MS=1000 WORKER_STALLED_MS=1000 \
QUEUE_TEST_REDIS_CONTAINER=agrid-queue-test-redis pnpm --filter @tabdo/server test:queue
```

故障用例会清空指定 `_queue_test` 数据库内的测试数据；设置 `QUEUE_TEST_REDIS_CONTAINER=agrid-queue-test-redis` 时，会暂时停止并恢复这个专用 Redis 容器验证断线恢复，要求端口 `6381`。不设置时该断线用例跳过，其余执行。短 lock/stalled 参数使崩溃接管在用例等待时间内完成。进程 fixture 位于 `server/test/queue/fault-worker.ts`；可选负载脚本为 `test:queue:load`，位于 `server/test/queue/load.ts`。


## 完整 Pi host journal 恢复证明

`server/test/harness/journal-recovery.test.ts` 使用本地 HTTP provider 与独立 UUID 原生会话，无数据库。第一轮保存官方 opaque resume/sandbox snapshot；第二轮九个只读 fixture 查询完成、模型尚未输出时读取该会话 host journal，忽略清理阶段新产生的 resume/snapshot。它只替换旧快照中同 basename 的原生日志，再用原样旧 resume 创建新官方会话和新 user turn。

断言同 filename、严格字节前缀、JSONL完整、最新 user prompt、9/9 toolCall结果覆盖与末条 toolResult；新 provider 请求能看到全部九个结果，工具执行计数仍九。该证明仅覆盖结果完整的只读查询，不证明缺失/损坏日志、未完成工具或未知写操作可以重放。它没有实现自动 crash recovery，也没有更改 runtime。

```bash
pnpm --filter @tabdo/server exec tsx --test test/harness/journal-recovery.test.ts
```

## 智能体工具设置

`server/test/harness/tool-settings.test.ts` 核对当前三种 adapter 目录与共享 ID；真实 Pi/HTTP provider 验证 native+host 工具过滤、禁用工具强制调用不执行、模型收到原生错误及 UI error 投影。`server/test/routes/chat.test.ts` 另外验证目录权限与 Harness 兼容性、配置持久化和保留/清空、真实聊天读取配置、被拒绝的建表和计划调用不修改数据库且无 mutation 通知、刷新保留结构化错误。

```bash
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server exec tsx --test test/harness/tool-settings.test.ts test/routes/chat.test.ts
```

上述 provider 为本地 HTTP fixture，执行者是实际官方 HarnessAgent/Pi，不是替代 agent loop；不代表 Codex/Claude 远程执行通过。
