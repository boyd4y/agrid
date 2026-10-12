import { Hono } from "hono";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import {
  HARNESSES,
  anyHarnessAvailable,
  listHarnesses,
  listProviders,
  resolveModel,
  type HarnessId,
} from "../ai/model.js";
import { createTableTools } from "../ai/tools.js";
import { mockTextStream, runMockAgent } from "../ai/mock-chat.js";
import { db } from "../db/index.js";
import { agentProfile, member } from "../db/schema.js";
import { resolveActor } from "../auth/actor.js";

export const chatRoute = new Hono();

chatRoute.get("/status", (c) => {
  const harnesses = listHarnesses();
  const providers = listProviders();
  return c.json({
    mode: anyHarnessAvailable() ? "live" : "mock",
    providers,
    harnesses,
    note:
      "OpenRouter is a standalone provider reusable by Codex/Claude/Pi. Chat picks an org agent; harness is locked on that agent. Built-in tools map 1:1 to /api/commands.",
  });
});

chatRoute.post("/", async (c) => {
  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const tableId = (body.tableId ?? body.body?.tableId) as string | undefined;
  const agentId = (body.agentId ?? body.body?.agentId) as string | undefined;

  if (!agentId) {
    return c.json(
      { error: "请先选择智能体。没有智能体时请先到 /app/agents 创建。" },
      400
    );
  }

  const actor = await resolveActor(c.req.raw);
  if (!actor?.organizationId) {
    return c.json({ error: "未授权" }, 401);
  }

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
    .where(eq(agentProfile.userId, profileUserId))
    .limit(1);

  if (!profile) {
    return c.json({ error: "智能体配置不存在" }, 404);
  }

  // Harness/model come ONLY from agent persona — client cannot swap
  const harness = (profile.persona?.defaultHarness ?? "pi") as HarnessId;
  const modelId =
    profile.persona?.defaultModel ??
    (harness === "pi" ? "openrouter/free" : undefined);

  if (!HARNESSES.includes(harness)) {
    return c.json({ error: `未知 harness: ${harness}` }, 400);
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText =
    lastUser?.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n") || "";

  const resolved = resolveModel(harness, modelId);
  const tools = createTableTools(tableId, actor.organizationId);

  // Only mock when selected agent harness has no API key (not because CLI missing)
  if (!resolved) {
    const { reply, mutated } = await runMockAgent({
      userText: lastText || "帮助",
      tableId,
      organizationId: actor.organizationId,
    });
    return mockTextStream(
      `【离线】智能体 harness「${harness}」未配置 API Key，走本地规则。\n配置 OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY 即可上线（不依赖 CLI）。\n\n` +
        reply,
      { mutated }
    );
  }

  const personaPrompt = profile.persona?.systemPrompt?.trim();
  const system = [
    personaPrompt ||
      "你是 Agrid 的 Talk-to-Build 助手（产品内 Vercel Harness 内置 tools，不是 MCP）。",
    "Agent-first：用户用对话建表、列、自动化、公式；表格 Grid/看板仍是核心数据视图，功能不削减。",
    "用户能在表格/看板上做的操作，你都能通过 built-in tools 完成。",
    "改单元格、增删行列、看板移卡前，先 get_table 拿列定义，再用 query_rows（窗口/游标，禁止全表）取行。",
    "select 列必须传选项 id（如 todo/doing/done），不要传中文 label。",
    "右侧预览是按需打开的 UI Slot 插件：默认关闭。需要让用户看到表格/结果时调用 open_preview；不需要时不要打开。",
    tableId
      ? `当前绑定的表格 ID: ${tableId}`
      : "用户尚未指定表格，先 list_tables；需要时可 create_table。",
    `当前智能体: ${profile.displayName}`,
    `当前 harness: ${harness} / model: ${resolved.modelId}（创建时锁定，对话内不可更换）`,
  ].join("\n");

  try {
    const result = streamText({
      abortSignal: c.req.raw.signal,
      model: resolved.model,
      system,
      messages: await convertToModelMessages(messages, { tools }),
      tools,
      stopWhen: stepCountIs(8),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        messageMetadata: ({ part }) => {
          if (part.type === "finish-step") {
            return {
              agentId: profile.memberId,
              harness,
              modelId: resolved.modelId,
              modelProvider: part.response?.modelId,
            };
          }
          return undefined;
        },
        onFinish: undefined,
      }),
    });
  } catch (err) {
    console.error("chat error", err);
    const msg = err instanceof Error ? err.message : String(err);
    return mockTextStream(
      `调用智能体「${profile.displayName}」(${harness}) 失败：${msg}\n请检查 API Key，或新建使用其他 Harness 的智能体。`
    );
  }
});
