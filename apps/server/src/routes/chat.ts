import { prepareHarnessUserPrompt } from "../harness/attachments.js";
import { Hono } from "hono";
import {
  createUIMessageStreamResponse,
  consumeStream,
  type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import {
  HARNESSES,
  NATIVE_DEFAULT_MODEL,
  anyHarnessAvailable,
  listHarnesses,
  listProviders,
  type HarnessId,
} from "../ai/model.js";
import { createTableTools } from "../ai/tools.js";
import { db } from "../db/index.js";
import { agentProfile, member } from "../db/schema.js";
import { resolveActor } from "../auth/actor.js";
import { z } from "zod";
import { resolveChatContext } from "../chat/context.js";
import { requireThread } from "../chat/store.js";
import { resolveAgentSkills } from "../skills/runtime.js";

import { createNativeAgent } from "../harness/runtime.js";
import { resolvePiModelMetadata } from "../harness/model-metadata.js";
import { createNativeChatStream } from "../harness/chat-stream.js";
import { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } from "../harness/store.js";
import { beginNativeRun } from "../harness/runs.js";
import { HTTPException } from "hono/http-exception";
import { createTaskTools, taskInstructions } from "../harness/tasks.js";
import { validateDisabledTools } from "../harness/tool-catalog.js";
import { questionContinuation, resumeQuestionRun } from "../harness/questions.js";
import type { NativeQuestionResultRequest } from "@tabdo/shared";

export const chatRoute = new Hono();

chatRoute.get("/status", (c) => {
  const harnesses = listHarnesses();
  const providers = listProviders();
  return c.json({
    mode: anyHarnessAvailable() ? "live" : "unconfigured",
    providers,
    harnesses,
    note:
      "Chat 使用原生 HarnessAgent。Pi 支持本地虚拟工作区；Codex/Claude Code 需要 Sandbox 与对应原生协议的模型配置。未配置时返回错误，不回落离线规则。",
  });
});

chatRoute.post("/", async (c) => {
  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) return c.json({ error: "未授权" }, 401);
  const common = z.object({ id: z.uuid(), agentId: z.string().min(1), context: z.unknown() });
  const body = z.discriminatedUnion("intent", [common.extend({ intent: z.literal("message"),
    messages: z.array(z.object({ id: z.string().min(1).max(200), role: z.enum(["user", "assistant"]), parts: z.array(z.object({ type: z.string() }).passthrough()).max(500) }).passthrough()).min(1),
  }), common.extend({ intent: z.literal("tool-result"), assistantMessageId: z.string().min(1),
    toolResults: z.array(z.object({ toolCallId: z.string().min(1), output: z.unknown() })).min(1),
  })]).parse({ intent: "message", ...await c.req.json() });
  const messages = (body.intent === "message" ? body.messages : []) as UIMessage[];
  const agentId = body.agentId;

  if (!agentId) {
    return c.json(
      { error: "请先选择智能体。没有智能体时请先到 /app/agents 创建。" },
      400
    );
  }

  const context = await resolveChatContext(body.context, actor);
  const tableId = context.context.tableId ?? undefined;
  const thread = await requireThread(body.id, actor);
  if (thread.status !== "regular") return c.json({ error: "对话状态无效，请刷新后重试" }, 409);
  if (thread.custom.resourceKey !== context.resourceKey) return c.json({ error: "对话与当前页面资源不一致，请新建对话" }, 409);

  // agentId = member id (preferred) or user id
  const [mem] = await db
    .select()
    .from(member)
    .where(
      and(
        eq(member.organizationId, actor.organizationId),
        eq(member.id, agentId)
      )
    )
    .limit(1);

  let profileUserId = mem?.userId;
  if (!profileUserId) {
    const [byUser] = await db
      .select()
      .from(agentProfile)
      .where(
        and(
          eq(agentProfile.organizationId, actor.organizationId),
          eq(agentProfile.userId, agentId)
        )
      )
      .limit(1);
    profileUserId = byUser?.userId;
  }

  if (!profileUserId) {
    return c.json({ error: "智能体不存在或不属于当前工作区" }, 404);
  }

  const [profile] = await db
    .select()
    .from(agentProfile)
    .where(and(eq(agentProfile.userId, profileUserId), eq(agentProfile.organizationId, actor.organizationId)))
    .limit(1);

  if (!profile) {
    return c.json({ error: "智能体配置不存在" }, 404);
  }

  // Harness/model come ONLY from agent persona — client cannot swap
  const harness = (profile.persona?.defaultHarness ?? "pi") as HarnessId;
  const configuredModel = profile.persona?.defaultModel;
  const modelId = configuredModel === NATIVE_DEFAULT_MODEL ? undefined : configuredModel;

  if (!HARNESSES.includes(harness)) {
    return c.json({ error: `未知 harness: ${harness}` }, 400);
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = lastUser ? prepareHarnessUserPrompt({ harness, parts: lastUser.parts }) : "";
  if (body.intent === "message") {
    if (!lastUser) return c.json({ error: "缺少用户消息" }, 400);
    if (!lastText.trim()) throw new HTTPException(400, { message: "请输入要执行的任务" });
  }
  const mode = profile.persona?.runtime ?? (harness === "pi" ? "local" : "sandbox");
  const disabledTools = validateDisabledTools(harness, profile.persona?.disabledTools ?? []);
  const skillContext = await resolveAgentSkills(actor.organizationId, profile.persona?.skillNames);
  const tools = { ...createTableTools(tableId, actor.organizationId, actor.userId), ...skillContext.tools };
  const personaPrompt = profile.persona?.systemPrompt?.trim();
  const agentsDocument = `# AGENTS.md\n\n${personaPrompt || "遵循 tabdo 工作区权限，使用实际工具验证结果，再向用户报告完成情况。"}`;
  const system = [
    personaPrompt ||
      "你是 tabdo 的 AI 助手，使用产品内置 tools 完成操作。",
    "按用户目标使用表格、记录、表单、自动化和报告工具完成任务。",
    "内置工具覆盖表格、行列、看板、表单、自动化和报告页面。只使用实际提供的工具，不要宣称完成工具不支持的操作。",
    "一次性新增多条记录、导入或生成mock示例数据使用batch_add_rows；已有记录批量修改/删除使用batch_update_rows / batch_delete_rows。create_automation创建持续处理未来事件的规则，数量多的单次写入仍是记录操作。",
    "需要用户选择或补充信息时使用askUserQuestions结构化提问；已有明确授权时直接执行所需工具。",
    "修改数据时使用真实表格、字段与记录 ID；缺少上下文时按需用 get_table 和 query_rows 查询，不重复读取已确认的信息。查询使用窗口或游标。",
    "select 列必须传选项 id（如 todo/doing/done），不要传中文 label。",
    "创建表格间关联字段使用 add_column：type=relation，relation 配置目标表和可选反向字段。add_relation / set_relation / remove_relation 只绑定或解除已有字段的记录关联，columnId 必须是字段 UUID，recordIds 必须是目标记录 UUID 数组。工具失败时根据错误原因修正，未成功的操作不得宣称已完成。",
    "报告是包含多个图表、数字和文字组件的页面。先 create_report 创建页面，再 add_report_widget 添加组件；修改前 get_report 获取组件ID，get_report_data 验证实际数据。各组件可使用不同来源，不能把字段名称当字段UUID。",
    "右侧预览是按需打开的 UI Slot 插件：默认关闭。需要让用户看到表格/结果时调用 open_preview；不需要时不要打开。",
    context.system,
    skillContext.instructions,
    `当前智能体: ${profile.displayName}`,
    `当前 harness: ${harness} / model: ${modelId ?? "默认模型"}（Harness 创建时锁定，模型来自智能体配置）`,
  ].join("\n");

  // Validate configuration before creating a run or saving user input.
  const piModel = harness === "pi" ? await resolvePiModelMetadata(modelId) : undefined;
  createNativeAgent({ harness, mode, modelId, piModel, instructions: system, agentsDocument, tools, skills: skillContext.skills });
  c.req.raw.signal.throwIfAborted();
  const lease = await claimRuntimeLease(body.id, actor);
  try {
    const record = await prepareRuntimeRecord(lease, actor, { profileId: profile.id, harness, mode });
    c.req.raw.signal.throwIfAborted();
    const pendingQuestion = questionContinuation(record);
    if (pendingQuestion && body.intent === "message") throw new HTTPException(409, { message: "智能体正在等待问题回答，请在问题卡片中选择或填写答案" });
    const resumed = body.intent === "tool-result" ? await resumeQuestionRun(lease, actor, record, body as NativeQuestionResultRequest) : undefined;
    const { id: userMessageId, ...userContent } = lastUser ?? { id: "", role: "user", parts: [] };
    const run = resumed?.run ?? await beginNativeRun(lease, actor, record, { id: userMessageId, parentId: null, format: "ai-sdk/v6", content: userContent }, profile.memberId);
    return createUIMessageStreamResponse({ stream: createNativeChatStream({
      actor, lease, record, run, harness, modelId, piModel, instructions: `${system}\n${taskInstructions(record)}`, agentsDocument,
      // The claimed Run owns cancellation. Closing the browser detaches its
      // projection; explicit stop is persisted through the Run cancel API.
      tools: { ...tools, ...createTaskTools(record) }, disabledTools, skills: skillContext.skills, prompt: lastText, messages: resumed?.messages ?? messages,
      toolResultContinuations: resumed?.toolResultContinuations,
      // A cancelled submission before the stream starts may have raced claim.
      // Once streaming starts, HTTP disconnects no longer cancel this Run.
      signal: c.req.raw.signal.aborted ? AbortSignal.abort(new DOMException("启动已取消", "AbortError")) : undefined,
      metadata: { agentId: profile.memberId, harness, modelId, runtime: mode },
    }), consumeSseStream: ({ stream }) => { void consumeStream({ stream }); } });
  } catch (error) {
    await releaseRuntimeLease(lease);
    throw error;
  }
});
