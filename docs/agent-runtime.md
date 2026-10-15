# Agent Chat、Session 与 Run

## 当前实现状态

`/api/chat` 已接入官方 `HarnessAgent`，不再调用旧 `streamText` 聊天链路或离线规则引擎。Chat 负责显示消息；Run 负责执行状态；Session 保存原生上下文。以下已验证范围以本地 Pi 为主，远程执行不冒充已验收。

已实现并验证：

- 官方 `HarnessAgent` 与 Pi/Codex/Claude Code adapter 构造，显式凭证与运行环境校验。
- 本地 Pi 原生工具循环、工具后文字响应、Skill 文件落地及 `AGENTS.md` 注入。
- 原生 session 停止后保存 opaque resume state 和隔离文件工作区，再创建新 agent/sandbox 续接历史。
- 数据库会话租约：原子抢占、续租、过期接管、旧实例 fencing；受保护操作持有租约行锁到事务结束。
- UI 回复、原生检查点和 Run 完成状态在同一事务提交，失败时一起回滚。
- Run 状态/阶段事件、租约心跳、账号/工作区隔离、停止接口和重复输入保护；UI 分支不控制原生恢复。
- 实际原生链路的续接、取消、整轮/单步/首个输出/流中断超时、SDK 步骤暂停与 continuation；已完成工具不会因继续操作而重放。
- 14 项原生基础设施测试及 24 项聊天测试通过；删除未使用的旧 streamText 循环与重复辅助测试。
- 智能体本地/Sandbox 配置与创建/编辑/刷新恢复浏览器验证；不支持的 Harness/环境组合在保存时拒绝。

计划与目标只取决于 Harness 原生能力，平台不再实现或注入独立计划/目标工具。AGENTS.md 从智能体人设生成。聊天展示原生消息、实际提问和必要错误，内部 Run 用于刷新与防止重复发送，不展示额外执行历史面板。自动化运行记录是独立资源，使用右侧 Sheet。


## 三种状态各自负责什么

| 概念 | 保存什么 | 用途 |
| --- | --- | --- |
| Chat / Thread | 消息、标题、用户和页面资源范围 | 在页面查看与切换对话 |
| Session | 原生日志、resume state、工作区文件 | 刷新或进程更换后保留智能体上下文 |
| Run | 一次执行的状态、步骤、错误、中断和续接信息 | 判断智能体正在做什么、是否完成、如何继续 |

聊天是一种执行入口。一次发送启动一个 Run；Run 使用对应 Session。恢复 Session 时传最新用户输入，不用 UI 消息数组重新重放完整历史；未完成的原生 turn 应使用官方 continuation 方法继续。

Run 接口：`GET /api/threads/:id/runs`、`GET /api/threads/:id/runs/:runId/events`、`POST /api/threads/:id/runs/:runId/cancel`。停止请求通过持久化标记传给持有租约的实例；默认每两秒检查一次，可配置 `AI_RUN_POLL_MS`。终态消息和检查点保存完成后释放租约。

Run 返回公开投影，不公开 session ID、fence、resume state 或文件。默认不设置步骤上限，按原生 Harness 运行到自然结束；`AI_CHAT_MAX_STEPS` 仅在显式正整数配置时设置 `stopWhen`。`canContinue` 仅对最新 Run 且保存状态对应本轮输入/回复、包含原生 `continueFrom` 时成立。暂停会话接收普通追问，无固定口令：Pi 使用官方 `continueStream` 和 `input` extension 一次提交本次输入；Codex/Claude 使用官方 `continueStream` 后 `experimental_steer`，等待 bridge accepted ACK，输入不被接收则如实失败，不静默丢弃。Bridge steering 是下一安全边界方向调整，不能保证恢复执行前原子插入；真实 Sandbox 仍未验收。历史 Run 不能作为继续入口。

原生消息只由服务端提交。客户端 history adapter 仅 load，append/update 无操作；旧客户端 `/messages` POST 保留权限检查但不写入。新请求仅发送本次用户消息，保留完整 UI 展示历史；没有200条历史的执行上限。服务端使用已保存原生回复选择新用户的展示父节点，不拒绝客户端 UI parent。历史中的未执行用户残留不进入原生输入；同一 ID 如未进入任何 Run 且非 server-final，可在接受本次输入时归位，已执行消息仍不可重做。GET history 的 head 以已接受原生输入/回复为准，不采用旧客户端失败消息推进的 head。进度写入及取消状态轮询故障不额外终止执行；真实租约失效与保存失败仍如实处理。

启动前 HTTP 请求已取消时不启动执行；完成 claim 并开始推送后，Run 独立于浏览器连接。响应通过 AI SDK 官方 `consumeSseStream` / `consumeStream` 保持消费原生执行的 UI 投影，使刷新和关闭页面不丢失终态提交。Composer Stop 先等待本轮持久 claim 并请求 cancel，停止按钮不会只关闭本地流伪装结束。运行中删除对话在租约锁内返回 409，要求停止并保存结果后删除。

刷新后页面轮询服务端 Run，恢复实际阶段并禁用重复发送；终态后使用 assistant-ui 的 `importExternalState` 原位恢复服务端消息，包括结构化工具结果。没有重新发模型请求。流中 token 不持久化重播，运行时先显示持久阶段；最终回复、检查点和完成状态提交后一起恢复。这个生命周期依赖当前 Node 进程存活，不是跨服务器重启的后台任务队列。进程崩溃或租约失效仍走已有失败判断；缺少本轮检查点时拒绝重放已执行工具，要求核对数据并新建对话。

Pi 的确定启动前失败/停止使用独立提交路径：在调用 `stream` 或 `continueStream` 之前设置保守执行标志，仅未调用时可以将失败说明、failed/cancelled Run 和下一条用户输入的 UI 边界原子保存，已有 opaque resume、文件快照和 sandbox ID 全部原样保留。失败输入没有进入原生日志，也不会在下一条消息中重放。已创建但未进入 turn 的 session 仍调用官方 stop 清理，不过其返回值不持久化：当前 Pi SDK 在这种情况下可以返回 `data:{}`。

首次会话只有在所有历史 Run 和 assistant 消息都精确对应服务端 `serverFinal` 未执行证明时，才允许下一条新输入；客户端 metadata 无法创建或覆盖这项证明。已有 Pi 状态必须包含实际日志引用，本地快照需有对应完整非空 JSONL。空/损坏状态、已进入 SDK invocation、进程中断或未知情况仍保留防重放限制；不会按工具数量为零推断安全，也不对未验证的 Codex/Claude bridge 提供启动前豁免。提交新的 Pi 状态同样检查日志引用，避免残留旧 JSONL 掩盖一个空 stop 状态。

开发 API 使用独立进程 supervisor：服务器及共享源码变更合并为待重载标记，正在执行的原生 Run（包括提交前的模型元数据与租约等待）完成保存后才重载。连续编辑不会强杀仍在执行的进程；开发 queue 仍与 API 并行运行。API 收到 SIGTERM/SIGINT 后停止接收新聊天请求，等待原生执行、检查点、租约释放及 HTTP 连接关闭，再关闭数据库连接。进程内计数仅用于停机，不替代数据库 Run 状态。旧的已启动 `tsx watch` supervisor 需要在下一次正常开发启动时更换；它自身的五秒强杀与重复编辑强杀无法由 API 信号处理器消除。SIGKILL、进程崩溃和机器退出仍无法保证最新检查点保存。

本地 Pi 的一次性人工维修有独立原生测试证明：原样使用旧 opaque resume state，并仅用同名最新 journal 替换旧工作区中的 journal，官方 `createSession` 和新用户 turn 能读取九个已有工具结果，工具执行计数不增加。维修须逐项验证日志严格延续旧快照、最新原生用户输入与目标 Run 的持久消息一致、工具调用和结果完整配对、末条是完整工具结果、没有悬空调用或 continuation，并在租约与对话锁内重验后原子提交。一次已验证的只读查询会话按此边界恢复：仅替换日志、更新下一轮可用的消息边界、追加恢复说明；失败 Run 与用户重试消息保留，opaque state、智能体和权限不变。没有自动重放工具或伪造原轮完成。这不构成对任意崩溃、缺失日志、未闭合工具结果、内置写入或其他 adapter 的恢复保证。

Harness 1.0.149 会隐藏 host tool 参数校验原因，且忽略继承的 `streamText.timeout`。业务工具保留原 JSON schema，在执行入口使用原校验器严格校验后才允许修改数据；安全错误原因由 SDK 原生工具循环传回模型。整轮、单步、首输出和流间隔超时均默认关闭，只有显式配置对应 `AI_CHAT_*_MS` 正整数才使用官方事件与外部 AbortSignal；用户 Stop、租约丢失仍中止执行。不自建模型/工具执行循环。自然 stop 没有正文不改判失败、不注入平台总结；真实 length/error/abort 如实报告并保留原内容。必要的错误说明标记“系统提示”，不要求特定回复口令。SDK 的 `stopWhen` 在下一条原生事件处检查，可能预取模型请求，不等同于精确的模型请求数量配额。

## 工具目录与智能体开关

工具设置只按类型控制平台工具（工作区成员查询、记录、字段、关联、批量、视图、表单、报告及自动化），不列出 Harness 内置工具，不注入平台计划/目标。运行使用官方 `inactiveTools` 过滤平台工具，原生能力由 adapter 自己提供。关闭工具不撤销已经完成的数据操作；智能体 Skill 分配仍决定其按需可读文件。

官方 schema、用户和工作区绑定、租约保护沿用普通聊天实现。MCP 复用同一命令层；本轮增加创建、修改、删除、读取自动化与运行记录接口。MCP 的外部用户 Key 是独立调用身份，不继承某个智能体的 UI 工具偏好，也不代表所有平台接口已完整覆盖。

`get_workspace` 读取当前工作区及执行成员身份；`list_members` 按姓名或邮箱查找人员与智能体，支持 `kind=human|agent`、offset/limit 分页。成员返回 `userId` 与成员记录 `id`，person 字段和 run_agent 的 agentUserId 都使用 `userId`。智能体查询还返回显示名与人设，不返回 API Key。两项工具共用已认证工作区范围及 UI 成员数据，MCP 使用相同命令层；模型不能传入其他 organizationId。原生 Harness 负责执行工具，平台不要求用户手动查找 ID。

## 运行环境

| 模式 | 当前 adapter | 文件和命令能力 |
| --- | --- | --- |
| local | Pi + Node 文件/进程适配器 | 每个会话独立真实临时目录，使用系统 bash、Node、Python 等已安装工具；CF 模式在专属容器内运行 |
| sandbox | 官方 Vercel sandbox + Pi/Codex/Claude Code | 远程文件与进程；原生 session 与 sandbox 分别保存和恢复 |

Codex 和 Claude Code 的 bridge 仍需已接入的网络 sandbox；真实文件和进程适配器并不代表这些 bridge 已完成接入。未配置运行环境或模型凭证时直接报错，原生工厂没有离线规则或普通模型调用回落。

Pi 可配置 `OPENROUTER_API_KEY`；自定义兼容提供商需要 `PI_API_KEY`、`PI_BASE_URL` 和模型 ID。Codex、Claude Code 分别使用显式 OpenAI Responses、Anthropic Messages 配置。运行层不会自动发现服务器个人 CLI 登录信息。

Sandbox 使用 `VERCEL_TOKEN`、`VERCEL_TEAM_ID`、`VERCEL_PROJECT_ID`，或部署环境 OIDC。已有 sandbox 必须通过 SDK resume lookup 恢复，不能拿旧 ID 调用 create 假装恢复。

四个内置技能来自 `apps/server/skills/{table,form,report,automation}` 的真实 `SKILL.md` 与递归引用/脚本文件。工作区启用和智能体分配的交集作为官方 `skills` bundle 传入 Harness；首次模型请求只收到名称、描述与读取位置，完整业务方法通过原生 `read` 按需读取。`skills-bundle.test.ts` 使用真实四包和官方 Pi 原生工具验证逐文件挂载、读取完整 report 文档/脚本及 `bash` 读取 reference；停止后恢复工作区并撤销 report 分配，SDK 移除旧目录，新 turn 无法再读取旧脚本。平台 API 与 Explorer 保持内置内容只读，管理员启停不修改内容。[官方 Skills 文档](https://ai-sdk.dev/docs/ai-sdk-harnesses/skills)说明这种按需加载与后续 turn 更新方式。

命令直接通过系统 bash 启动真实进程，文件读写落在真实目录；Railway Node 镜像包含 bash、Node 和 Python 3。普通 Node 本地模式使用宿主已安装的程序，临时目录用于文件组织，并不提供操作系统级隔离；远程工作区由所选 Sandbox 提供对应执行能力。工作区快照仅收集自有目录，不跟随符号链接，不保存服务器文件或环境变量。旧内存工作区快照按逻辑路径恢复到真实目录，原生会话继续由 SDK 恢复。

真实远程验收使用显式启用的 `test:harness:remote` 命令，覆盖原生远程 read/write/bash、AGENTS 与按需读取的真实生产 report Skill/reference/Python script。原生 write 创建独立 CSV，原生 bash 执行 `summarize-csv.py` 并校验真实 JSON 聚合；停止 Sandbox 后通过官方恢复核对原生历史、文件/输出保留和脚本计数仍为一，最终销毁测试资源。它使用当前产品 node24 模板，缺少 Python 会明确失败，不能靠安装解释器或宿主运行冒充该环境支持。Pi 模型由宿主本地 fixture 提供，不需要付费模型或业务数据库。缺凭证、未启用或任何执行/清理失败都不算 PASS；本机当前缺 Vercel 凭证，只完成类型检查、阻断 preflight 和生产脚本的宿主窄参数/JSON契约验证，真实远程仍未验收。命令和退出码见 [测试说明](testing.md)。

## 并发边界

同一对话只允许一个租约持有人。抢占是单条条件 UPSERT，不是先查询空闲再写入。新持有人递增 fence；旧 token/fence 不能续租、提交检查点或释放新持有人。

持有租约行锁执行数据库操作可以防止检查所有权与修改之间被接管。它不等于所有外部副作用恰好执行一次；进程在操作成功后、检查点保存前崩溃仍需要业务幂等或核对。读取 Run 时锁定租约再判定过期，不把正在提交的工具误判为中断；没有最新 turn 检查点时禁止恢复旧快照并重放工具，要求核对数据并新建对话。

## 开发验证

源码放 `apps/server/src/harness/`；测试放平级目录 `apps/server/test/harness/`。各包全部测试和持续浏览器回归已迁入平级 `test/`，统一入口见 [测试说明](testing.md)。

使用独立测试数据库并先执行迁移；测试命令拒绝应用数据库：

```sh
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm --filter @tabdo/server test:harness
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test pnpm --filter @tabdo/server test:chat
```

原生 Pi 测试运行真实 SDK，模型由本地 HTTP fixture 返回响应，不会调用付费模型。数据库测试验证并发抢占和原子提交，没有修改应用数据。

官方依据：[HarnessAgent 会话、生命周期与 continuation](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)，[adapter 能力](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)。


## 原生工具与平台工具

Harness 内置工具由对应适配器管理，不在平台工具设置中单独罗列或禁用。计划能力只取决于 Harness 原生支持；平台不再注入计划/目标指令、工具或额外任务状态接口。旧配置中的已知内置工具 ID 和已移除的四个任务工具 ID 在加载、保存及执行入口归一化时忽略；未知 ID 仍按配置错误拒绝。

工具设置只控制平台数据操作与 Skill 读取工具，使用官方 `inactiveTools` 执行禁用。原生 `askUserQuestions` 保留标准问题与答案续接流程。内部 `/workspace/agent/AGENTS.md` 在官方 onSession 生命周期生成，下一次运行采用最新人设。历史迁移和已保存的旧任务数据保留，本轮不删除数据库列或用户数据。

## Pi 模型预算与空回复

2026-10-15：固定官方 Harness 1.0.152、Pi adapter 1.0.154，并统一 AI SDK 7.0.141。原生 Pi fixture 验证首次超时后重试成功不会追加旧的 `Request timed out.`，后续真正失败仍会如实报告；工具不因重试重复执行。此修复不消除供应商网络超时本身。

OpenRouter通过公开 `/models` 辅助获取实际context_length与提供商输出上限，缓存5分钟，查询最多2秒。网络/HTTP/解析故障或目录遗漏ID不拦执行：优先复用已有真实缓存，无缓存则使用显式环境配置/保守默认，实际供应商最终判断模型能力；推测值不写成目录缓存。`PI_MAX_OUTPUT_TOKENS` 默认16384，且受成功目录中的提供商上限约束。冷缓存未知模型仍可能受保守32768窗口影响，需要真实 `PI_CONTEXT_WINDOW`；错误窗口可能触发Pi SDK自身上下文裁剪。没有以目录不可用或遗漏模型为由要求用户新建会话。

2026-10-13 实际问题确认：末轮原生 assistant.stopReason=length、usage.output=8192、usage.reasoning=8192、text为0；前一轮已有正文但同样length，被旧逻辑误报completed。原因是推理计入总输出预算，且dynamic openrouter/free的reasoning=false让Pi跳过thinkingLevel=off的请求参数。

使用官方 `createPi.providers.*.models[].samplingParams` 明确传递 `reasoning: { enabled: false, effort: "none" }`，让现有off设置真正进入OpenRouter请求；不修改SDK、不开额外工具循环。强制推理的模型可能拒绝none，此时按提供商真实错误处理，不能声称所有模型都能关闭推理。[Pi配置文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#configure-sampling-by-thinking-level)、[OpenRouter输出与推理预算](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。

当前Pi adapter把原生length归一化为stop。通过官方可信inline extension的 `message_end` 只读观察最后一个assistant的原始stopReason和usage，保存到消息metadata.completion；不将中间length提前定失败。最终length无论有无正文均标记failed，保留部分正文并提示达到输出上限，下一次用户输入沿原生会话接着回答，不自动重试或重放工具。其它空正文不推断为length。官方unfinished turn仍保持suspended，依SDK continuation继续。

## 自动化中的原生智能体动作

`run_agent` 只配置 `agentUserId` 和 `prompt`。自动化创建者的实时成员身份是执行身份，选中的智能体必须属于同一工作区。persona、model、skills、平台工具与隔离环境均复用 `prepareNativeChatAgent`；后台调用普通聊天的官方 Harness 执行核心，没有第二套模型循环或 HTTP 回环。

每个自动化动作先短事务创建一条稳定的私有 workspace 对话与输入ID，再释放事务执行原生 stream。重复投递读取同一 native run 和持久输出，不重发本次事件。真实 Harness 提问对应 `waiting_input`，用户从运行 Sheet 打开 `/app?thread=<id>`，在普通对话回答；原生完成后 worker 自动接续剩余数据动作。同一 pending 问题和 tool-result 均沿官方 continuation。

运行中或未完整保存的原生动作不冒充完成，不自行重试已执行工具。只有既有服务器 `NOT_INVOKED` 证书证明输入从未发送给 Pi 时，才使用相同 run/input/assistant ID重试启动。取消、供应商错误和缺配置如实保存。故障发生在外部副作用之后仍需要核对，不能承诺所有外部效果恰好一次。

本地原生 SDK fixture 已验证实际平台工具执行、持久正文、重复投递、真实待答和同一输入续接。未使用用户模型或 Vercel 凭证。原生宿主工具目前沿用会话租约事务，需要正常连接池（至少2连接）；单连接池仅适用于纯数据库 command composition 测试，不能支撑嵌套原生宿主调用。
