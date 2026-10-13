import { prepareHarnessUserPrompt } from "../harness/attachments.js";
import { Hono } from "hono";
import {
  createUIMessageStreamResponse,
  consumeStream,
  type UIMessage,
} from "ai";
import {
  anyHarnessAvailable,
  listHarnesses,
  listProviders,
} from "../ai/model.js";
import { resolveActor } from "../auth/actor.js";
import { z } from "zod";
import { resolveChatContext } from "../chat/context.js";
import { requireThread } from "../chat/store.js";

import { prepareNativeChatAgent } from "../harness/preparation.js";
import { createNativeChatStream } from "../harness/chat-stream.js";
import { claimRuntimeLease, prepareRuntimeRecord, releaseRuntimeLease } from "../harness/store.js";
import { beginNativeRun } from "../harness/runs.js";
import { HTTPException } from "hono/http-exception";
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
  const thread = await requireThread(body.id, actor);
  if (thread.status !== "regular") return c.json({ error: "对话状态无效，请刷新后重试" }, 409);
  if (thread.custom.resourceKey !== context.resourceKey) return c.json({ error: "对话与当前页面资源不一致，请新建对话" }, 409);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  let lastText = "";
  const { profile, harness, modelId, mode, disabledTools, skills, tools, agentsDocument, system, piModel } =
    await prepareNativeChatAgent({ actor, agentId, context, validateInput: harness => {
      lastText = lastUser ? prepareHarnessUserPrompt({ harness, parts: lastUser.parts }) : "";
      if (body.intent === "message") {
        if (!lastUser) throw new HTTPException(400, { message: "缺少用户消息" });
        if (!lastText.trim()) throw new HTTPException(400, { message: "请输入要执行的任务" });
      }
    } });
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
      actor, lease, record, run, harness, modelId, piModel, instructions: system, agentsDocument,
      // The claimed Run owns cancellation. Closing the browser detaches its
      // projection; explicit stop is persisted through the Run cancel API.
      tools, disabledTools, skills, prompt: lastText, messages: resumed?.messages ?? messages,
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
