# Harness SDK alignment

tabdo uses `HarnessAgent` and adapter-owned native history. UI messages remain a
projection; neither ordinary prompts nor question answers replay old tool calls.

## Questions

The common tool is the installed SDK's `HARNESS_V1_BUILTIN_TOOLS.askUserQuestions`.
Pi and Codex receive that tool without `execute`; Claude Code exposes its native
`AskUserQuestion` through the adapter's canonical `askUserQuestions` mapping.
Plain A/B/C prose is not intercepted or converted into a tool call.

Question and answer types in `packages/shared/src/questions.ts` mirror the SDK
input/output schemas. Answers use question IDs and option IDs, with the SDK's
`answered`, `partially-answered`, `declined`, or `cancelled` actions. Free-form
text is available unless the question explicitly sets `allowFreeForm: false`.
The server validates answers against the stored pending call, including option
membership and partial-answer permissions; client-created calls are not trusted.

An unanswered question ends the current stream slice with an unfinished native
turn. The server detaches using the SDK, persists its opaque continuation and the
assistant message, and keeps its own sandbox handle warm as a lifecycle
optimization. A browser refresh can read the stored question and answer it. The answer
request has `intent: "tool-result"`, `assistantMessageId`, and `toolResults`;
it appends no user message. The server commits the answer to the same assistant
message and calls official `continueStream` with typed `ToolResultPart` values:
`output: { type: "json", value: answer }`. The Run ID and assistant ID are reused.

If continuation startup fails after an answer is accepted, the stored answer and
native state remain available and the Run records the actual error. The user can
explicitly retry the answer while the SDK continuation still lists that pending
call; a failed/cancelled Run label is not an additional restore gate. It is not
certified as an uninvoked original turn or automatically replayed. Deleting the
thread discards its warm handle through official SDK lifecycle calls.

### Proven and unproven boundaries

The installed versions checked against npm are Harness 1.0.149, Pi/Codex
1.0.151, and Claude Code 1.0.153. Pi's destructive suspension path settles a
pending host question with a `Pi session suspended` error. Its official parked
session path preserves a clean continuation. This implementation enables that
path; a warm handle is not a restore prerequisite. An actual producer process
exits after official detach and workspace capture, and a separate consumer
process successfully resumes the pending answer through official SDK state.
No application journal rewrite or old prompt replay is involved. Damaged or
missing native state still produces the real SDK/restore error. Ordinary
completed Pi history restores through the SDK as before.

`apps/server/test/harness/questions.test.ts` proves actual Harness/Pi execution
with a deterministic HTTP provider and an isolated PostgreSQL database: pending
question persistence, same-turn answer delivery, one original user message,
exactly one data mutation, a new SDK step boundary, completion followed by a
fresh prompt, answer validation, answer-preserving startup failure and explicit
retry on the same Run, restore without a warm handle, and explicit
resource deletion without a model call. The separate
`questions-process.test.ts` proves producer exit and cross-process question
continuation with no shared warm or SDK parked-session map. Neither calls a
live model or edits a native journal.

Claude/Codex question support is connected according to the installed official
adapter types and bridge implementation. Real remote Sandbox execution of these
question flows remains unverified without the required credentials; the Pi test
does not count as remote acceptance.

The official [Harness tools documentation](https://ai-sdk.dev/docs/ai-sdk-harnesses/tools)
describes client tools, pending results, and continuation. The official
[Harness UI documentation](https://ai-sdk.dev/docs/ai-sdk-harnesses/ui) describes
native history and keeping unfinished sessions warm. Other SDK capabilities
should be added when their product behavior and adapter support can be verified,
without replacing the SDK's native execution loop.

## 当前能力核对

| 能力 | 接入方式与核对结果 |
| --- | --- |
| 原生执行与会话历史 | `HarnessAgent` / 官方 adapter 管理执行循环；只发送本轮输入，不将 UI 全量历史重新当成模型输入。 |
| 恢复、停止与释放 | SDK `createSession`、`detach`、`stop`、`destroy` 与 opaque resume state；已验证本地跨进程恢复待回答问题。Run 的展示状态不作为恢复前置。 |
| Skill 包 | `skills` 原生传入 name/description/content/files；引用文件和脚本随包物化；正文按需读取，与 tool 独立。下一轮读取最新已启用分配。 |
| Tool 与开关 | 官方 `tool` / `inputSchema` / host execute；`inactiveTools`控制平台工具和适配器支持关闭的原生工具。9项batch入口共享schema；`askUserQuestions`三平台目录一致可见。 |
| 用户询问 | 官方 canonical `askUserQuestions`、客户端 `addResult`、标准 tool-result continuation；支持单选、多选、自由文字、部分回答和拒绝。 |
| Plan / Goal | 作为独立平台工具在原生执行环境保存业务任务进展；不把计划状态当成SDK执行暂停/结束条件。原生适配器的规划工具仍由自身执行。 |
| 进度、正文与错误 | SDK stream / step / tool / finish原生事件投影到assistant-ui；保留真实错误和输出上限，不伪造助手总结或固定继续口令。 |
| 本地与Sandbox | Pi使用官方JustBash隔离文件系统；Codex/Claude使用官方Vercel Sandbox和原生adapter。真实远程执行仍需独立验证，不影响本地验证。 |
| 附件输入 | 当前三adapter实际均拒绝ImagePart/FilePart。统一预检返回具体版本限制；关闭默认AI SDK上传adapter，避免UI宣称支持而丢弃输入。 |

工具权限仍由服务端真实租户权限与执行租约控制。SDK可选审批、自动步骤上限和执行超时没有作为默认交互额外开启；用户选择是提问工具结果，不是对每次数据操作新增审批。

本轮验证：真实Pi本机provider+隔离DB的提问/答案同Run续接、回答启动失败后的显式恢复、工具不重放；独立两个进程恢复待回答状态；Chrome刷新/单选多选文字/标准答案回传；附件真实拒绝且零图片下载/模型请求；标准batch原生100条写入和MCP入口。Codex/Claude远程能力按官方schema接入，不能将本地Pi证明说成三个远程adapter已实测。
