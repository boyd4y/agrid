# 测试与浏览器回归

测试与源码按包平级：`apps/server/test/{ai,commands,queue,reports,skills,harness,storage,routes}`、`packages/shared/test`、`packages/ui/test`、`apps/client/test`。生产 TypeScript 只编译 `src`；apps/server/shared 构建先清理 `dist`，避免旧编译测试残留。apps/server/shared 的 `tsconfig.test.json` 单独覆盖测试和其源码导入，检查时不输出文件。

## 常规检查

```bash
pnpm typecheck
pnpm typecheck:test
pnpm --filter @tabdo/shared test
pnpm --filter @tabdo/client test
# 数据库须独立、已迁移，名称以 _agent_test 结尾
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
DATABASE_URL_UNPOOLED=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm test
pnpm build
```

运行数据库测试或迁移时，显式将 `DATABASE_URL` 与 `DATABASE_URL_UNPOOLED` 都指向同一个专用测试库。迁移优先使用 `DATABASE_URL_UNPOOLED`；若当前 shell 已有私有/Neon 配置，只覆盖一个 URL 可能会把迁移导向另一个数据库。测试库必须独立，不能使用用户或业务数据。

server 常规入口覆盖 AI 错误、关联、报告/独立自动化、Skill、原生 Harness 和 chat API。仍保留 `test:chat`、`test:relations`、`test:reports`、`test:skills`、`test:harness` 各业务入口。`test:queue` 单独运行，因为它要求专用队列数据库和 Redis，不能与其他用例共用存储。

`apps/server/test/harness/skills-bundle.test.ts` 无数据库依赖，读取生产内置 bundle（含 site），使用真实官方 Pi native read/bash 验证按需加载完整文档、引用和脚本。它还将工作区快照恢复为仅分配 form 的新实例，验证 SDK 删除 report 挂载并拒绝旧脚本读取。该用例通过原生 bash 执行真实 Python 脚本并断言聚合输出；真实文件、引用和会话跨恢复保留。普通 Node 用例验证宿主进程；远程 Sandbox 需单独显式启用验收。单独运行：

```bash
pnpm --filter @tabdo/server exec tsx --test test/harness/skills-bundle.test.ts
```

## 显式启用的真实 Sandbox 验收

`apps/server/test/harness/remote-smoke.ts` 是显式远程验收入口，实际创建 Pi Sandbox，并让 Pi 使用本地确定性 HTTP 模型 fixture；fixture 不替代 Sandbox、文件/命令、同 ID 恢复或资源销毁。脚本默认选择 Vercel，可用 `--provider vercel|e2b|railway` 指定提供商。先根据 `.env.example` 在测试进程环境中配置对应凭证：

- Vercel：`VERCEL_TOKEN`、`VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID`，或 `VERCEL_OIDC_TOKEN`。
- E2B：`E2B_API_KEY`；`E2B_TEMPLATE` 与 `E2B_TIMEOUT_MS` 可选。
- Railway：`RAILWAY_API_TOKEN` 与专用 `RAILWAY_SANDBOX_ENVIRONMENT_ID`；可选 checkpoint、region 和 idle timeout。不要使用应用部署环境 ID。

先检查配置，再明确启用真实资源创建：

```bash
pnpm --filter @tabdo/server test:harness:remote -- --provider e2b --preflight
HARNESS_REMOTE_SMOKE=1 pnpm --filter @tabdo/server test:harness:remote -- --provider e2b
```

将 `e2b` 替换为 `vercel` 或 `railway` 可检查另一提供商。缺少配置、组合当前不可用或未设置 `HARNESS_REMOTE_SMOKE=1` 时退出码为 2，不创建 Sandbox。preflight 只检查配置是否存在；不验证凭证有效性，也不算远程验收通过。失败、跳过、fixture 或实现代码不能记为云 PASS。

截至 2026-10-17 的支持边界：Local 的 Pi、Codex、Claude Code 均有实际产品运行；E2B 仅开放 Pi，其他组合默认拒绝；Railway Pi 有最终真实云产品运行记录，Codex/Claude/Claude Code 当前拒绝且不应新建云资源；Vercel 真实云运行尚未验收。详细结果见内部 `docs/agent-runtime.md` 的组合矩阵。不要把 provider preflight、契约测试或本地模型 fixture 当成相应 Harness/提供商的真实云验证。

运行会检查二进制文件读写、缺失文件、非零退出码、公开端口、AGENTS 文档、按需读取的 report Skill/reference/Python script、CSV 聚合结果和执行计数。脚本完成一个原生 turn 后停止会话并尝试以同一 Sandbox ID 恢复，然后确认历史、文件和输出保留且脚本未重放，最后销毁本次创建的资源。Railway 的停止会关闭执行句柄但不会暂停 VM；它会运行并可能继续计费，直到空闲超时或显式销毁。E2B stop 会暂停环境；到期或销毁后不能恢复旧会话。任何未销毁的资源必须依据脚本报告的自有 Sandbox ID 清理，不触碰其他环境。

本机曾因缺少 Vercel 凭证而无法进行真实 Vercel 云验收；该限制不代表 E2B/Railway 的验证结果。每次准备真实验收前都要重新确认所用凭证、隔离环境和当前支持组合。

## 实际浏览器回归

`apps/server/test/harness/startup-boundary.test.ts` 使用独立 `*_agent_test` 数据库和真实 HarnessAgent/Pi、本地 HTTP provider。它断言新版 SDK 在未提交输入时 stop 保留原生日志身份，应用也不会把启动前状态覆盖为成功 turn；首轮失败与取消后的新输入、已有会话的启动前失败/停止、未完成 session 的错误输入与官方继续均不重放已提交工具。客户端伪造未执行证明和旧空状态仍拒绝恢复。它只证明明确未调用 Pi invocation 的边界，不证明进程崩溃后的自动重放安全。

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
- `agent-tools`：三步创建与编辑左侧工具 Tab；platform 缺省开启、native 由 Harness 管理、真实 API 保存/取消/刷新恢复、跨步骤和 Tab 草稿保留、搜索/目录错误重试、light/dark 和窄屏。主题截图等待输入颜色过渡完成，避免截到切换中间帧。
- `platform-style`：Settings、Skill 列表/详情、Reports 列表/Builder、Automations 列表/来源选择的紧凑 light/dark 截图；有记录的报告刷新失败和自动化失败重试；Skill 文件选择、复制失败反馈与真实剪贴板；主题单选和侧栏偏好刷新恢复。
- `kanban-drag`：整卡标题/正文的原生浏览器拖拽，Sheet 打开/关闭前后真实 PATCH 与状态持久化、无误开详情；卡片菜单控件不触发行拖拽；统一删除确认的取消/失败 toast/重试/删除刷新恢复。API 通知会刷新看板列，动作先等待数据稳定，再定位当前语义标题/正文，不依赖合成 drag 事件或过期卡片坐标。

新增 browser suite 放 `apps/client/test/browser/*.mjs`，复用 `fixture.mjs`；默认入口自动发现 suite 并串行执行。`fixture.mjs` 提供本地 provider metadata，涉及模型执行的 suite 通过 `modelRequest` 提供 HTTP fixture，不连接真实供应商。

可配置 `BROWSER_BASE_URL`、`BROWSER_API_PORT`、`BROWSER_CHANNEL`、`BROWSER_EXECUTABLE_PATH`、`BROWSER_ARTIFACT_DIR`。默认截图、API 日志与 Dashboard 帧轨迹写入被 git 忽略的 `apps/client/test/artifacts/<运行时间>/`，无用户绝对路径或 `/tmp` 文件依赖。

## 队列进程与 Redis 故障测试

能力包测试：`QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381 pnpm -r --filter @tabdo/core --filter @tabdo/db --filter @tabdo/auth --filter @tabdo/queue --filter @tabdo/storage --filter @tabdo/agent-runtime test`。通用 BullMQ 用例使用专用测试 Redis 和随机前缀；未配置时明确跳过。Node 服务使用既有 PG/Redis 测试契约。

`pnpm --filter @tabdo/agent-runtime test` 在独立包内验证真实 Pi 工具循环、原生历史和真实文件工作区恢复，不连接产品数据库/远程模型。平台级 `test:harness` 使用 `_agent_test`，覆盖实际 SDK 跨进程提问续接；保留已验证的原生 reattach 配置。工厂 Session 签名隔离与 CORS/资源配置测试在 `test/routes/platform-factories.test.ts`。

专用 PostgreSQL 数据库名称必须以 `_queue_test` 结尾，并先执行迁移；Redis 使用专用实例与 `agrid-queue-test` 前缀。下面使用本地已有测试实例，绝不能改成业务数据库/Redis：

```bash
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/agrid_atomic_queue_test \
DATABASE_URL_UNPOOLED=postgresql://tableapp:tableapp@localhost:5432/agrid_atomic_queue_test \
  pnpm --filter @tabdo/server db:migrate
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/agrid_atomic_queue_test \
DATABASE_URL_UNPOOLED=postgresql://tableapp:tableapp@localhost:5432/agrid_atomic_queue_test \
REDIS_URL=redis://127.0.0.1:6381 QUEUE_PREFIX=agrid-queue-test-regression \
AUTOMATION_LEASE_MS=1000 WORKER_LOCK_MS=1000 WORKER_STALLED_MS=1000 \
QUEUE_TEST_REDIS_CONTAINER=agrid-queue-test-redis pnpm --filter @tabdo/server test:queue
```

故障用例会清空指定 `_queue_test` 数据库内的测试数据；设置 `QUEUE_TEST_REDIS_CONTAINER=agrid-queue-test-redis` 时，会暂时停止并恢复这个专用 Redis 容器验证断线恢复，要求端口 `6381`。不设置时该断线用例跳过，其余执行。短 lock/stalled 参数使崩溃接管在用例等待时间内完成。进程 fixture 位于 `apps/server/test/queue/fault-worker.ts`；可选负载脚本为 `test:queue:load`，位于 `apps/server/test/queue/load.ts`。


## 完整 Pi host journal 恢复证明

`apps/server/test/harness/journal-recovery.test.ts` 使用本地 HTTP provider 与独立 UUID 原生会话，无数据库。第一轮保存官方 opaque resume/sandbox snapshot；第二轮九个只读 fixture 查询完成、模型尚未输出时读取该会话 host journal，忽略清理阶段新产生的 resume/snapshot。它只替换旧快照中同 basename 的原生日志，再用原样旧 resume 创建新官方会话和新 user turn。

断言同 filename、严格字节前缀、JSONL完整、最新 user prompt、9/9 toolCall结果覆盖与末条 toolResult；新 provider 请求能看到全部九个结果，工具执行计数仍九。该证明仅覆盖结果完整的只读查询，不证明缺失/损坏日志、未完成工具或未知写操作可以重放。它没有实现自动 crash recovery，也没有更改 runtime。

```bash
pnpm --filter @tabdo/server exec tsx --test test/harness/journal-recovery.test.ts
```

## 智能体工具设置

`apps/server/test/harness/tool-settings.test.ts` 核对当前三种 adapter 目录与共享 ID；真实 Pi/HTTP provider 验证平台工具过滤、旧 native/task 配置归一化后原生工具仍可调用、禁用工具强制调用不执行、模型收到原生错误及 UI error 投影。`apps/server/test/routes/chat.test.ts` 另外验证目录权限与 Harness 兼容性、配置持久化和保留/清空、真实聊天读取配置、被禁用的建表调用不修改数据库且无 mutation 通知、已移除计划工具没有实现、刷新保留结构化错误。

```bash
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server exec tsx --test test/harness/tool-settings.test.ts test/routes/chat.test.ts
```

上述 provider 为本地 HTTP fixture，执行者是实际官方 HarnessAgent/Pi，不是替代 agent loop；不代表 Codex/Claude 远程执行通过。

## 文件存储

本地与 S3 协议 fixture、失败清理和隔离数据库路由测试已纳入 server 常规测试入口，配置与精确范围见 [文件存储](file-storage.md)。真实远程对象服务仍需独立验收，测试不读取用户 S3 配置或文件。

## 通用事件自动化与集成

```sh
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server test:automations
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server exec tsx --test test/routes/integrations.test.ts test/harness/automation-agent-action.test.ts
```

`test/automation/` 验证真实数据命令与receipt原子事务、顺序引用、已提交步骤不重放、邮件补正文后条件match/skip，以及并发计划去重和DST。原生智能体 fixture 使用实际官方Pi、平台数据工具、askUserQuestions和普通chat答案续接；断言同一native run/input及单次工具副作用。所有fixture精确清理自己组织，不truncate其他测试组织。

`integrations.test.ts` 用官方Svix、固定origin的AgentMail协议fixture和真实DB测试投递、认证、body上限、事务故障不ACK、幂等与生命周期。不会连接真实AgentMail。`event-automations` browser suite 覆盖端点一次性token、定时/事件分页隔离、typed动作保存、事件绑定/重载、失败草稿重试与自动化运行Sheet；集成界面验证四个设置tabs、无内部搜索/tabs、单创建入口、居中Dialog、错误重试与注册失败保留选择。首次连接的上游响应使用浏览器fixture，凭证创建与修改实际写入隔离库，不宣称已连接真实邮箱。

新来源配置接口、模型与远程执行边界见 [事件自动化](event-automations.md)与[集成部署](integrations.md)。生产外部服务凭证验收不包含在本地PASS范围。

## 设置标签页与个人密钥

`api-keys` browser suite 验证个人密钥创建/真实删除及失败重试，删除后GET列表为空且旧Bearer立即401，并核对设置框架、垂直标签、深链、刷新、浏览器返回、旧集成地址跳转和未知标签归一化。两个suite直接检查选中菜单伪元素不显示、整行高亮、列表四边边框与间距、真实hover/focus反馈及统一删除颜色。320px验证先收起现有AppShell侧栏，局部tabpanel核对scrollWidth/clientWidth，不用全局隐藏溢出冒充通过；它不代表全站侧栏已实现手机自动收起。常规只保留外观/语言，没有布局开关。

`automation-sources` 验证内联来源卡片的固定高度和底部间距、表格/邮件/邮箱空状态、菜单图标一致性、窄屏与深浅模式；定时任务使用专门单页表单，保存真正的 `run_agent` 智能体与任务描述、时间/时区，失败保留输入，列表与旧链接独立路由。`native-controls.test.mjs` 扫描应用和 UI 包，禁止原生 picker、datalist、单选/滑条和 details 表面；共享组件以 Storybook 展示。浏览器文件选择仅保留隐藏的系统文件选择入口，不在产品中渲染原生文件控件。

## 名称、看板与成员身份回归

在隔离的 `_agent_test` 数据库迁移后，可单独执行：

```sh
pnpm --filter @tabdo/server exec tsx --test test/commands/name-conflicts.test.ts test/harness/workspace-tools.test.ts
pnpm --filter @tabdo/client test:browser -- name-conflicts kanban-overflow
```

名称测试覆盖数据库直接写入、作用域重名、并发、历史重复与批量回滚。看板测试检查中文、连续长文本和换行内容在两种密度下的实际宽度与省略号，并确认详情交互。成员测试使用官方 Pi Harness 与本地模型 fixture，依次读取成员工具的真实结果、更新 person 字段、检查已保存 userId；同时核对跨工作区隔离、智能体查询与分页。测试不发送真实模型请求，不修改已有工作区数据，也不生成截图。

## 定时任务会话

`browser/scheduled-sessions.mjs` 验证左侧任务与右侧运行卡片、空状态、原生会话继续、结果摘要更新、编辑返回以及窄屏布局。它只创建隔离工作区，使用本地模型 fixture，普通 `/threads` 列表不能返回定时任务会话。

`test/harness/automation-agent-action.test.ts` 验证由实际定时动作创建的 `scheduled_task` 会话、任务归属、私人会话权限、运行分页，以及继续消息仍使用同一个原生 runtime session、不会重复已完成的工具操作。`test/routes/chat.test.ts` 中手动取消不再保存停止系统提示，超时仍保留原因与工具结果。


## 显式业务依赖

`apps/server/src/business` 通过参数接收资源，不使用 ALS 或 HTTPException。`pnpm check:architecture` 防止平台 SDK 和隐式资源访问进入业务 services；基础包不引用应用或产品 schema；Node 入口保留既有调用签名。

```sh
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server exec tsx --conditions=development --test test/commands/backend-services.test.ts test/runner/explicit-services.test.ts test/automation/outbox.test.ts
```

这些用例直接注入 PG/时钟/UUID/队列，验证 tenant、caller transaction 原子性、lease/fence、持久接受/输出、成员撤销和 outbox claim/补偿。Outbox 使用独立临时 schema，避免认领并行测试的事件。HTTP 工厂仍由 `test/routes/platform-factories.test.ts` 验证原生 Better Auth、PG、签名隔离和连接释放。远程 Sandbox 的验收方式见前文，不能将本地 PASS 当成线上通过。

## 通用 Queue / Worker 包

`packages/queue` 验证消息契约、Redis 参数与原子租约、稳定投递 ID 及不暴露提供方对象的检查/统计接口。`packages/worker` 实际依赖 queue，以报告/邮件任务验证并发、瞬时与永久失败、重试耗尽、延迟不消耗失败次数、租约续期/丢失、关闭排空和缺失投递恢复。outbox 的 claim/fence SQL 保留应用隔离 PG 测试。

在专用 Redis 6381 可用时运行：

```bash
QUEUE_ADAPTER_TEST_REDIS_URL=redis://127.0.0.1:6381 pnpm --filter @tabdo/queue --filter @tabdo/worker test
```

每个夹具使用随机 `agrid-queue-test` 前缀，只删除自己的键；不设置变量时真实 Redis 用例跳过，不能将其算作验收成功。worker 的 Node host 测试使用临时子进程验证 SIGTERM、启动时 SIGINT 和关闭超时。产品后台入口仍是 `src/queue/main.ts`，业务处理器与配置位于 `src/automation/jobs`。

## Redis 唤醒与数据库空闲

先完成 `pnpm build:foundation`，再运行测试，避免构建清空 `dist` 时并行启动测试。
准备专门的 `tabdo_event_queue_test` 数据库及 Redis 6381，迁移时必须同时覆盖
`DATABASE_URL` 和 `DATABASE_URL_UNPOOLED`，避免本地 Neon 配置把迁移指向另一个数据库。

```bash
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_event_queue_test \
DATABASE_URL_UNPOOLED=postgresql://tableapp:tableapp@localhost:5432/tabdo_event_queue_test \
  pnpm --filter @tabdo/server db:migrate
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_event_queue_test \
DATABASE_URL_UNPOOLED=postgresql://tableapp:tableapp@localhost:5432/tabdo_event_queue_test \
REDIS_URL=redis://127.0.0.1:6381 QUEUE_PREFIX=agrid-queue-test-event-local \
  pnpm --filter @tabdo/server test:queue:events
```

真实 PG/Redis 验证事务提交与嵌套 savepoint 回滚、通知失败不影响提交、空闲期间 SQL 计数不增长、及时投递、多批 drain、延迟重试、定时任务改期/停用、重复消息、启动恢复和丢失通知的安全扫描。原生 Pi 提问续接回归另验证 canonical checkpoint 提交后的线程级通知。测试不证明真实 Neon 已休眠或 Railway 已部署。

## API Key 与表格数据 API

`test/routes/api-key-migration.test.ts` 在事务内独立 schema 验证 0030 保留旧 Key/hash 和操作范围，结束后回滚。`site-api.test.ts` 验证逐表 CRUD、REST/GraphQL/SDK 一致性、无读取权限的更新/删除、版本冲突、私有关联删除保护和权限变更即时生效。限流用例使用独立本地 Redis 的 6381/16381 端口。

浏览器套件 `api-keys`、`site-api` 验证合并后的设置入口、逐表权限矩阵和真实跨域 HTML 读写；运行方式与上文浏览器回归相同。

## 站点闭环

`test/routes/sites.test.ts` 验证独立工作区、真实本地对象存储、不可变发布版本、预览代数、并发保存冲突、存储失败保留原发布、历史恢复、撤下和删除。`pnpm test:browser -- sites` 使用真实原生Pi与本机provider fixture，通过原生read读取生产Site Skill，再执行真实save_site/open_preview；在浏览器完成代码编辑、实时预览、草稿恢复、API Key绑定、保存发布、SDK模块加载、读取活动、实际报名写入、版本恢复和撤下删除，并验证不透明源隔离及桌面/深色/窄屏。该fixture验证协议与业务操作，不代表真实DeepSeek模型的场景质量。
