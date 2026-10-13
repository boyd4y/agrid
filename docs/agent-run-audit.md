# Agent Run 额外干预审核（2026-10-13）

范围：聊天路由、官方 HarnessAgent/Pi 入口、运行状态与保存恢复、目标/计划、assistant-ui 消息操作。代码审核覆盖 Pi/Codex/Claude adapter 配置；本轮执行验证使用本地 Pi 和隔离测试数据库，不冒充远程验证。

原则：原生 Harness 决定执行过程。平台负责权限、可靠保存、同步界面与用户主动停止，不按任意任务预算推断执行完成或要求固定口令。

## 整改清单

| 项目 | 原行为 | 整改 |
| --- | --- | --- |
| 步数 | 默认 16 步主动暂停 | 默认无上限；仅显式 `AI_CHAT_MAX_STEPS` 正整数开启 |
| 四类超时 | 默认整轮 5 分钟、步骤 90 秒、首输出 45 秒、流间隔 30 秒主动停止 | 默认关闭；仅显式对应 `AI_CHAT_*_MS` 正整数开启 |
| 继续口令 | 已暂停 Pi 会话拒绝普通追问 | 官方 `continueStream` 加 Pi 官方 `input` extension，一次性提交本次真实输入；不重放历史工具 |
| 无总结正文 | 自然结束只有工具结果/推理也改判 failed | 尊重原生自然 stop；不合成暂停/失败总结 |
| 真实错误提示 | 平台文字外观像模型正文且要求继续口令 | 必要提示明确标注“系统提示”，删除输出截断后的固定下一步指导；实际 length/error/abort 保留 |
| 消息重做/编辑/分支 | 普通 chat 入口与 native 单一历史、防重放冲突 | 删除 Reload、旧消息 Edit、BranchPicker；保留复制、导出、正常发送和用户 Stop |
| 恢复状态 | 暗示只能继续原任务剩余步骤 | 改为可继续发送消息，可追问或改变方向 |
| 任务指令 | “当前请求只执行这一轮”可能诱导提前收尾 | 明确计划/目标仅记录进度，不限制当前原生执行；只说明不会自动启动下一轮 |
| 强制查询顺序 | 每次修改前机械重复 get_table/query_rows | 缺上下文才查询，复用已确认真实 ID |
| 内部保存术语 | 向用户展示“原生检查点” | 对外使用“结果未完整保存” |

## 保留的保护与部署配置

- 租户、私有对话、资源权限、工具参数校验与用户 disabledTools。
- 单对话租约、fence、受保护写入与续租；失去所有权后停止写入。
- 重复提交保护，避免同一用户提交被再次执行。客户端 UI 消息分支不应决定原生 Session 是否可以恢复；上一轮将两者一起列为防重放保护不准确，见下方补充审核。
- 原生历史损坏或保存失败如实报错；不拿 UI 历史重新执行工具来伪造恢复。
- 用户主动 Stop；浏览器断连/刷新不自动取消已启动执行。
- 保存完成状态与消息/原生会话一起提交；正在执行时不删除对话。
- 模型输出预算与真实提供商上限。这是单次响应能力，不是整个任务步骤限制。
- 计划/目标为用户要求的可选工具；不会据此自动暂停、结束 Run 或启动后台执行。保留输入和记录一致性校验。
- 最终结果持久化依赖数据库和租约，保存失败如实报告；进度观测写入失败只记录日志，不中止原生执行。
- 本地快照文件数/容量是现有存储能力边界；不删除资源限制后冒充可靠保存。

## 能力边界

- Pi 普通追问恢复已通过真实原生请求验证。Codex/Claude bridge 已删除固定口令，通过官方续接和 steering 等待新输入 accepted ACK；接收失败明确失败，没有静默吞消息。源码生命周期已复核，真实 bridge Sandbox 未验收。默认步骤和超时限制已对全部 adapter 关闭。
- 远程 Sandbox 的真实执行需要独立凭证验收，本地开发不需要。
- OpenRouter 的 thinking-off 请求和输出预算保留上一轮截断诊断修复；模型本身是否支持该设置属于提供商配置能力，不保证所有模型都支持。
- 不自动重跑旧会话或替用户补做已完成工具，不修改用户现有数据和历史消息。

官方依据：[HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)、[Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。

## 验证结果

隔离测试数据库、本机兼容 SSE 服务和实际 Pi adapter：routes 10 项（含用户主动停止）、startup-boundary 2 项、output-limit 2 项通过。覆盖 17 次工具往返自然结束、显式 2 步暂停后的普通追问、四类显式超时、真实输出截断、无正文自然 stop 保存真实工具结果并接收下一输入，已完成工具不重放。server 生产/测试与 client 类型检查通过。没有使用用户模型或修改用户历史，不生成截图。

## 18:42 继续失败后的统一补充审核（只读，尚未整改）

上一轮自检遗漏了 HTTP 拒绝后 history adapter 保存用户消息的实际交互。这是审核遗漏，不是原生 Harness 不支持恢复。

实际对话只读核对：保存的 resume state 和 unfinished continuation 均存在；指定 journal 文件存在、JSONL 可解析、session header 有效，共152条记录。数据库 UI head 后方多出两条非 server-final 用户消息，原生 lastAssistant 没有变化。它们未获准进入原生执行，却被前端保存为 UI head。后续消息引用这些 UI 消息，触发自定义 parent 校验；请求没有进入 Harness。

| 剩余逻辑 | 位置 | 审核结论 |
| --- | --- | --- |
| UI parent 必须等于原生 lastAssistant；首轮不能有 UI parent | `server/src/harness/runs.ts` | 多余执行拦截，取消 UI 消息树对原生恢复的否决权；新输入的展示父节点由服务端选取 |
| history append/update 在 HTTP 拒绝后也保存用户消息 | `client/src/lib/chat-persistence.ts` | 两套写入权冲突；原生执行由服务端保存获准输入与结果，客户端 history 仅加载 |
| 已保存同 ID 的临时用户消息不允许换 parent | `server/src/chat/store.ts` | 与服务端规范化产生竞态；只能规范化未获准运行、非 server-final 的待提交用户消息，不能改已执行消息 |
| 按 imported Run ID / assistant 存在条件跳过同步 | `client/src/components/chat/ChatRuns.tsx` | HTTP 拒绝不生成新 Run，旧 ID 不变，因此不修正本地错误分支；需与纯展示历史同步分开 |
| 继续按钮读取 UI history head，再发送继续消息 | `client/src/components/chat/ChatRuns.tsx` | UI head 已污染时同样失败；按钮不是独立的原生恢复接口，不应依赖错误消息分支 |
| 最新 Run 与保存的输入边界不一致就要求新建对话 | `server/src/harness/runs.ts` | 需收敛到真实保存完整性。完整状态的 failed/cancelled/suspended 都不应因状态名称被拒绝；实际丢失最新执行结果仍不能以旧快照冒充完整恢复 |
| 无 resume state 的多重 SQL“未执行证明”与手工 Pi journal 检查 | `server/src/harness/runs.ts`、`chat-stream.ts` | 自定义恢复层较重；完整状态直接交官方恢复，缺失/损坏必须具体报原因，不能静默新建空会话或重放 UI tools |
| Codex/Claude 已暂停时固定继续口令 | `server/src/routes/chat.ts`、`chat-stream.ts` | 仍为额外平台限制；需要按相应官方输入/续接能力处理，而非要求口令或吞掉普通追问 |
| 请求携带完整 UI history，最多200消息 | `server/src/routes/chat.ts`、`client/src/components/chat/ChatPanel.tsx` | 原生执行只需要最新输入；当前累积 UI history 可让长会话撞请求上限，应精简传输 |
| 进度保存/轮询失败影响控制流程，GET runs 会更新过期执行为 failed | `server/src/harness/chat-stream.ts`、`runs.ts` | 区分观测状态和原生执行状态；租约失效必须停止，单纯进度展示失败不应拥有额外执行控制权 |
| 每轮模型目录前置检查、强制 thinking off、输出预算 | `server/src/harness/model-metadata.ts`、`runtime.ts` | 模型配置层，不是会话是否可恢复的证据；目录网络失败目前可挡住已有会话，配置和恢复应解耦。真实提供商上下文/输出上限仍存在 |
| Plan/Goal最多40步、一个进行中、关闭/替换约束 | `server/src/harness/tasks.ts` | 额外产品状态约束，不属于 Harness 执行生命周期；当前不会直接暂停 Run，但应避免旧任务状态阻止新方向 |
| 本地工作区4000项/32MB、全部文件与原生日志一起快照 | `server/src/harness/workspace.ts` | 存储部署边界；不能把快照容量问题归为用户会话不能续接，不能丢原生日志后假称保存成功 |
| 平台错误说明仍插入 assistant text | `server/src/harness/chat-stream.ts` | 已标注系统提示，但仍是平台文字；应与模型内容分开呈现，不据此生成“任务未完成/需继续”的工作流 |

应保留：访问权限、工具真实参数校验、同消息幂等、租约与防并发写、用户主动停止、真实持久化错误。`session.hasUnfinishedTurn()` 选择官方 continuation 或新 prompt 是 SDK 生命周期要求，不是平台额外“任务状态”检查。

本次只更新审核记录，未改运行逻辑、未更改用户消息或数据、未调用用户模型。旧历史中的暂停/无正文说明不会因代码更新自动消失，也不能据旧文字判断新执行仍使用旧限制。

## 用户授权后的整改结果（当前实现，以此节为准）

- 删除 UI parent 对恢复的硬拒绝和首次 parent 限制；服务端用真实保存的原生回复选择展示父节点。仅未进入 Run、非 server-final 的旧待提交用户消息可归位；同一提交幂等与已执行消息保护保留。
- 客户端 history 仅 load，append/update 不写；旧客户端 POST messages 也不再推进 head。GET history 取接受后的原生 head，旧 HTTP 拒绝残留不会挡恢复或进入模型历史。
- 客户端只发送最新 user，界面仍保留全部历史；服务端移除200条 UI 历史上限。
- 删除所有 Harness 的继续口令 regex。Pi 原生 input extension；Codex/Claude 官方 steering 等 accepted ACK，失败如实处理，未冒充远程验收。
- 进度写入/取消轮询故障只记录同步问题，不因观察事件失败中止模型；真正租约失效、续租失败和持久化失败仍保护数据一致性。
- 模型目录改为辅助信息，2秒查询，故障复用真实旧缓存或显式配置/保守默认；目录遗漏ID不再提前拒绝。冷缓存未知上下文仍是配置能力边界。
- 删除40步、单个进行中、已关闭目标不能改计划、计划未完成不能更新目标、已有目标不能替换/重开等平台硬限制。目标和计划只记录用户任务状态，不控制 Run 生命周期。
- 保留真实 Session 数据缺失、尚未保存最新执行结果的检查，不能恢复旧快照后假装工具没有执行；完整保存的失败/停止/暂停状态不因状态名称被拒绝。权限、租约、同一提交防重复、用户主动 Stop 保留。
