# Agent Chat、Session 与 Run

## 当前实现状态

`/api/chat` 已接入官方 `HarnessAgent`，不再调用旧 `streamText` 聊天链路或离线规则引擎。Chat 负责显示消息；Run 负责执行状态；Session 保存原生上下文。以下已验证范围以本地 Pi 为主，远程执行不冒充已验收。

已实现并验证：

- 官方 `HarnessAgent` 与 Pi/Codex/Claude Code adapter 构造，显式凭证与运行环境校验。
- 本地 Pi 原生工具循环、工具后文字响应、Skill 文件落地及 `AGENTS.md` 注入。
- 原生 session 停止后保存 opaque resume state 和隔离文件工作区，再创建新 agent/sandbox 续接历史。
- 数据库会话租约：原子抢占、续租、过期接管、旧实例 fencing；受保护操作持有租约行锁到事务结束。
- UI 回复、原生检查点和 Run 完成状态在同一事务提交，失败时一起回滚。
- Run 状态/阶段事件、租约心跳、账号/工作区隔离、停止接口、重复输入和分支校验。
- 实际原生链路的续接、取消、整轮/单步/首个输出/流中断超时、SDK 步骤暂停与 continuation；已完成工具不会因继续操作而重放。
- 14 项原生基础设施测试及 24 项聊天测试通过；删除未使用的旧 streamText 循环与重复辅助测试。
- 智能体本地/Sandbox 配置与创建/编辑/刷新恢复浏览器验证；不支持的 Harness/环境组合在保存时拒绝。

plan/goal 已通过私有对话工具持久化，聊天 header 可查看，刷新后恢复；AGENTS.md 从智能体人设内部生成，不提供额外工作区设置。聊天仅展示当前等待、停止、必要的原生继续和消息内错误反馈；用户要求移除额外的执行历史面板，内部 Run 状态仍用于刷新恢复和防止重复发送。自动化运行日志不受影响。本地真实浏览器流断开、刷新恢复、启动中停止与失败反馈已验收。远程 Sandbox 已接官方创建/恢复接口与配置测试，尚未用真实凭证验证。

## 三种状态各自负责什么

| 概念 | 保存什么 | 用途 |
| --- | --- | --- |
| Chat / Thread | 消息、标题、用户和页面资源范围 | 在页面查看与切换对话 |
| Session | 原生日志、resume state、工作区文件 | 刷新或进程更换后保留智能体上下文 |
| Run | 一次执行的状态、步骤、错误、中断和续接信息 | 判断智能体正在做什么、是否完成、如何继续 |

聊天是一种执行入口。一次发送启动一个 Run；Run 使用对应 Session。恢复 Session 时传最新用户输入，不用 UI 消息数组重新重放完整历史；未完成的原生 turn 应使用官方 continuation 方法继续。

Run 接口：`GET /api/threads/:id/runs`、`GET /api/threads/:id/runs/:runId/events`、`POST /api/threads/:id/runs/:runId/cancel`。停止请求通过持久化标记传给持有租约的实例；默认每两秒检查一次，可配置 `AI_RUN_POLL_MS`。终态消息和检查点保存完成后释放租约。

Run 返回公开投影，不公开 session ID、fence、resume state 或文件。`canContinue` 仅对最新 Run 且检查点对应本轮输入/回复、包含原生 `continueFrom` 时成立。UI 先核对最新状态，加载持久消息，再发送“继续执行”；服务端仍由 `HarnessAgent.continueStream` 续接，不重放 UI 历史或工具。历史 Run 不能作为继续入口。

启动前 HTTP 请求已取消时不启动执行；完成 claim 并开始推送后，Run 独立于浏览器连接。响应通过 AI SDK 官方 `consumeSseStream` / `consumeStream` 保持消费原生执行的 UI 投影，使刷新和关闭页面不丢失终态提交。Composer Stop 先等待本轮持久 claim 并请求 cancel，停止按钮不会只关闭本地流伪装结束。运行中删除对话在租约锁内返回 409，要求停止并保存结果后删除。

刷新后页面轮询服务端 Run，恢复实际阶段并禁用重复发送；终态后使用 assistant-ui 的 `importExternalState` 原位恢复服务端消息，包括结构化工具结果。没有重新发模型请求。流中 token 不持久化重播，运行时先显示持久阶段；最终回复、检查点和完成状态提交后一起恢复。这个生命周期依赖当前 Node 进程存活，不是跨服务器重启的后台任务队列。进程崩溃或租约失效仍走已有失败判断；缺少本轮检查点时拒绝重放已执行工具，要求核对数据并新建对话。

Pi 的确定启动前失败/停止使用独立提交路径：在调用 `stream` 或 `continueStream` 之前设置保守执行标志，仅未调用时可以将失败说明、failed/cancelled Run 和下一条用户输入的 UI 边界原子保存，已有 opaque resume、文件快照和 sandbox ID 全部原样保留。失败输入没有进入原生日志，也不会在下一条消息中重放。已创建但未进入 turn 的 session 仍调用官方 stop 清理，不过其返回值不持久化：当前 Pi SDK 在这种情况下可以返回 `data:{}`。

首次会话只有在所有历史 Run 和 assistant 消息都精确对应服务端 `serverFinal` 未执行证明时，才允许下一条新输入；客户端 metadata 无法创建或覆盖这项证明。已有 Pi 状态必须包含实际日志引用，本地快照需有对应完整非空 JSONL。空/损坏状态、已进入 SDK invocation、进程中断或未知情况仍保留防重放限制；不会按工具数量为零推断安全，也不对未验证的 Codex/Claude bridge 提供启动前豁免。提交新的 Pi 状态同样检查日志引用，避免残留旧 JSONL 掩盖一个空 stop 状态。

开发 API 使用独立进程 supervisor：服务器及共享源码变更合并为待重载标记，正在执行的原生 Run（包括提交前的模型元数据与租约等待）完成保存后才重载。连续编辑不会强杀仍在执行的进程；开发 queue 仍与 API 并行运行。API 收到 SIGTERM/SIGINT 后停止接收新聊天请求，等待原生执行、检查点、租约释放及 HTTP 连接关闭，再关闭数据库连接。进程内计数仅用于停机，不替代数据库 Run 状态。旧的已启动 `tsx watch` supervisor 需要在下一次正常开发启动时更换；它自身的五秒强杀与重复编辑强杀无法由 API 信号处理器消除。SIGKILL、进程崩溃和机器退出仍无法保证最新检查点保存。

本地 Pi 的一次性人工维修有独立原生测试证明：原样使用旧 opaque resume state，并仅用同名最新 journal 替换旧工作区中的 journal，官方 `createSession` 和新用户 turn 能读取九个已有工具结果，工具执行计数不增加。维修须逐项验证日志严格延续旧快照、最新原生用户输入与目标 Run 的持久消息一致、工具调用和结果完整配对、末条是完整工具结果、没有悬空调用或 continuation，并在租约与对话锁内重验后原子提交。一次已验证的只读查询会话按此边界恢复：仅替换日志、更新下一轮可用的消息边界、追加恢复说明；失败 Run 与用户重试消息保留，opaque state、智能体和权限不变。没有自动重放工具或伪造原轮完成。这不构成对任意崩溃、缺失日志、未闭合工具结果、内置写入或其他 adapter 的恢复保证。

Harness 1.0.149 会隐藏 host tool 参数校验原因，且忽略继承的 `streamText.timeout`。业务工具保留原 JSON schema，在执行入口使用原校验器严格校验后才允许修改数据；安全错误原因由 SDK 原生工具循环传回模型。等待限制使用官方事件与外部 AbortSignal，不自建模型/工具执行循环。SDK 的 `stopWhen` 在下一条原生事件处检查，可能预取模型请求，不等同于精确的模型请求数量配额。

## 工具目录与智能体开关

`GET /api/members/agents/tools?harness=pi|codex|claude` 返回当前已安装官方 adapter 的 `builtinTools` 元数据，以及真实业务、Skill 检索、目标和计划的 host 工具定义。目录分 `builtin` / `platform`，不把平台工具伪装成内置工具。Pi 7 个、Codex 4 个、Claude Code 48 个声明的原生工具；平台共 59 个。三个已安装 adapter 都声明支持原生工具过滤；未声明支持过滤或审批的原生工具会标为 `alwaysEnabled` 并拒绝关闭。原生声明可能仍要求对应 runtime、MCP 或外部环境；目录不是远程执行验收。

`persona.disabledTools?: string[]` 缺省或 `[]` 全开启，新增工具默认开启。创建/修改保持 owner/admin 权限，拒绝未知、重复和当前 Harness 不支持的名称；普通成员可读取目录。人设 JSON 已持久化，无新数据库迁移。运行使用 [官方 `inactiveTools`](https://ai-sdk.dev/docs/ai-sdk-harnesses/tools#tool-filtering) 原样传入完整 host+native 工具集合，由 SDK 执行过滤和拒绝；没有手工删除定义或应用自己的执行循环。

原生 `read`/`bash` 操作隔离工作区；平台工具经过原 schema 校验、组织/用户绑定与会话 lease。关闭 `read_skill` 只禁用该平台检索入口，原生 Skill 文件仍由 Skill 分配决定；关闭 native `read`/`bash` 会限制其相应能力。计划/目标四个工具也可关闭，均列入工作计划组。关闭工具不更改已有数据、计划或技能分配。

本地 Pi 真 SDK 已验证：关闭的 native/host 工具未出现在实际 provider 工具目录，强行调用平台工具执行计数为零，模型收到原生拒绝原因，UI 保存 `output-error`，没有表格变更事件或计划写入。SDK 的 host 拒绝结果可能是 `execution-denied` payload，按失败投影和统计；Pi 对未暴露工具直接返回原生 `tool-error`。已有真实 schema 错误、业务失败、模型纠正、历史刷新、组织隔离、取消和 lease proof 继续通过。Codex/Claude 的过滤能力已核对安装包与官方接口，真实远程调用仍属于下方 Sandbox 待验收范围。

外部 MCP token 客户端拥有独立工具接口和权限入口，不使用某个聊天智能体的工具偏好。当前 MCP 缺少报告、自动化、建表和部分表单布局接口；没有把 host 工具目录标成已完成 MCP 全覆盖。需要另外对齐这些业务入口，私有对话目标/计划和 UI 预览也不能机械暴露为 MCP 工具。

## 运行环境

| 模式 | 当前 adapter | 文件和命令能力 |
| --- | --- | --- |
| local | Pi host runtime + 官方 just-bash sandbox | 每个会话隔离的虚拟工作区和 shell；不挂载服务器磁盘，也不是完整操作系统 |
| sandbox | 官方 Vercel sandbox + Pi/Codex/Claude Code | 远程文件与进程；原生 session 与 sandbox 分别保存和恢复 |

Codex 和 Claude Code 的 bridge 需要能暴露端口的网络 sandbox，本地 just-bash 不能替代它。未配置运行环境或模型凭证时直接报错，原生工厂没有离线规则或普通模型调用回落。

Pi 可配置 `OPENROUTER_API_KEY`；自定义兼容提供商需要 `PI_API_KEY`、`PI_BASE_URL` 和模型 ID。Codex、Claude Code 分别使用显式 OpenAI Responses、Anthropic Messages 配置。运行层不会自动发现服务器个人 CLI 登录信息。

Sandbox 使用 `VERCEL_TOKEN`、`VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID`，或部署环境 OIDC。已有 sandbox 必须通过 SDK resume lookup 恢复，不能拿旧 ID 调用 create 假装恢复。

四个内置技能来自 `server/skills/{table,form,report,automation}` 的真实 `SKILL.md` 与递归引用/脚本文件。工作区启用和智能体分配的交集作为官方 `skills` bundle 传入 Harness；首次模型请求只收到名称、描述与读取位置，完整业务方法通过原生 `read` 按需读取。`skills-bundle.test.ts` 使用真实四包和官方 Pi 原生工具验证逐文件挂载、读取完整 report 文档/脚本及 `bash` 读取 reference；停止后恢复工作区并撤销 report 分配，SDK 移除旧目录，新 turn 无法再读取旧脚本。平台 API 与 Explorer 保持内置内容只读，管理员启停不修改内容。[官方 Skills 文档](https://ai-sdk.dev/docs/ai-sdk-harnesses/skills)说明这种按需加载与后续 turn 更新方式。

本地 just-bash 实测 `python3` 返回不可用、退出码 127，因此加载 `report/scripts/summarize-csv.py` 不代表执行成功。report 文档仅在具备 Python 的环境运行该脚本；本地可读取 metrics reference，并使用现有产品聚合工具。远程 Python 能力仍需在真实 Sandbox 验证。

真实远程验收使用显式启用的 `test:harness:remote` 命令，覆盖原生远程 read/write/bash、AGENTS 与按需读取的真实生产 report Skill/reference/Python script。原生 write 创建独立 CSV，原生 bash 执行 `summarize-csv.py` 并校验真实 JSON 聚合；停止 Sandbox 后通过官方恢复核对原生历史、文件/输出保留和脚本计数仍为一，最终销毁测试资源。它使用当前产品 node24 模板，缺少 Python 会明确失败，不能靠安装解释器或宿主运行冒充该环境支持。Pi 模型由宿主本地 fixture 提供，不需要付费模型或业务数据库。缺凭证、未启用或任何执行/清理失败都不算 PASS；本机当前缺 Vercel 凭证，只完成类型检查、阻断 preflight 和生产脚本的宿主窄参数/JSON契约验证，真实远程仍未验收。命令和退出码见 [测试说明](testing.md)。

## 并发边界

同一对话只允许一个租约持有人。抢占是单条条件 UPSERT，不是先查询空闲再写入。新持有人递增 fence；旧 token/fence 不能续租、提交检查点或释放新持有人。

持有租约行锁执行数据库操作可以防止检查所有权与修改之间被接管。它不等于所有外部副作用恰好执行一次；进程在操作成功后、检查点保存前崩溃仍需要业务幂等或核对。读取 Run 时锁定租约再判定过期，不把正在提交的工具误判为中断；没有最新 turn 检查点时禁止恢复旧快照并重放工具，要求核对数据并新建对话。

## 开发验证

源码放 `server/src/harness/`；测试放平级目录 `server/test/harness/`。各包全部测试和持续浏览器回归已迁入平级 `test/`，统一入口见 [测试说明](testing.md)。

使用独立测试数据库并先执行迁移；测试命令拒绝应用数据库：

```sh
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm --filter @tabdo/server test:harness
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm --filter @tabdo/server test:chat
```

原生 Pi 测试运行真实 SDK，模型由本地 HTTP fixture 返回响应，不会调用付费模型。数据库测试验证并发抢占和原子提交，没有修改应用数据。

官方依据：[HarnessAgent 会话、生命周期与 continuation](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)，[adapter 能力](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)。


## 计划与目标

复杂任务可使用 `update_plan` 维护步骤。用户明确提出持续目标时使用 `create_goal`；`update_goal` 更新进度或按用户指令暂停、取消。`get_task_state` 读取当前状态。目标完成前要求计划所有步骤已完成，单个 Run 的终态不会自动关闭目标，也不意味着存在后台自主续跑。

工具通过现有租约保护执行，计划/目标事务锁定对应 runtime 记录；读取接口 `GET /api/threads/:id/task-state` 只公开 plan/goal/mode/updatedAt，不暴露原生 resume state、文件或远程环境凭证。聊天 header 的计划按钮按需加载，运行时轮询、切换对话时取消旧请求。内部 `/workspace/agent/AGENTS.md` 在官方 onSession 生命周期生成，下一次运行采用最新人设。

## Pi 模型预算与空回复

OpenRouter通过公开 `/models` 元数据使用实际context_length与提供商输出上限，缓存5分钟。`PI_MAX_OUTPUT_TOKENS` 默认16384，且受提供商上限约束；目录中的nullable上限不再额外回落8192，缓存区分显式预算。自定义兼容端点需设置真实 `PI_CONTEXT_WINDOW`（默认32768）。错误模型上限会触发Pi SDK自己的上下文预算裁剪：实际历史/工具定义超过错误32k窗口时曾产生 `max_tokens=1`，导致只有一个reasoning token。路由在创建Run和保存本次输入前校验模型元数据。

2026-10-13 实际问题确认：末轮原生 assistant.stopReason=length、usage.output=8192、usage.reasoning=8192、text为0；前一轮已有正文但同样length，被旧逻辑误报completed。原因是推理计入总输出预算，且dynamic openrouter/free的reasoning=false让Pi跳过thinkingLevel=off的请求参数。

使用官方 `createPi.providers.*.models[].samplingParams` 明确传递 `reasoning: { enabled: false, effort: "none" }`，让现有off设置真正进入OpenRouter请求；不修改SDK、不开额外工具循环。强制推理的模型可能拒绝none，此时按提供商真实错误处理，不能声称所有模型都能关闭推理。[Pi配置文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#configure-sampling-by-thinking-level)、[OpenRouter输出与推理预算](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。

当前Pi adapter把原生length归一化为stop。通过官方可信inline extension的 `message_end` 只读观察最后一个assistant的原始stopReason和usage，保存到消息metadata.completion；不将中间length提前定失败。最终length无论有无正文均标记failed，保留部分正文并提示达到输出上限，下一次用户输入沿原生会话接着回答，不自动重试或重放工具。其它空正文不推断为length。官方unfinished turn仍保持suspended，依SDK continuation继续。
