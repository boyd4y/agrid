import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDatabase } from "@tabdo/backend/resources";
import { agentProfile, member } from "../db/schema.js";
import type { Actor } from "../auth/actor.js";
import type { resolveChatContext } from "../chat/context.js";
import { HARNESSES, NATIVE_DEFAULT_MODEL, type HarnessId } from "./contracts.js";
import { validateDisabledTools } from "./tool-settings.js";

/** Product admission only: scoped identity/persona resolution, no SDK or tool closures. */
export async function resolveChatAgentConfiguration({ actor, agentId, context, boundTableId, validateInput }: {
  actor: Actor; agentId: string; context: Awaited<ReturnType<typeof resolveChatContext>>;
  /** A server-validated automation target; never accepted from a chat client. */
  boundTableId?: string;
  validateInput?: (harness: HarnessId) => void;
}) {
  const tableId = boundTableId ?? context.context.tableId ?? undefined;
  // agentId = member id (preferred) or user id
  const [mem] = await getDatabase()
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
    const [byUser] = await getDatabase()
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
    throw new HTTPException(404, { message: "智能体不存在或不属于当前工作区" });
  }

  const [profile] = await getDatabase()
    .select()
    .from(agentProfile)
    .where(and(eq(agentProfile.userId, profileUserId), eq(agentProfile.organizationId, actor.organizationId)))
    .limit(1);

  if (!profile) {
    throw new HTTPException(404, { message: "智能体配置不存在" });
  }

  // Harness/model come ONLY from agent persona — client cannot swap
  const harness = (profile.persona?.defaultHarness ?? "pi") as HarnessId;
  const configuredModel = profile.persona?.defaultModel;
  const modelId = configuredModel === NATIVE_DEFAULT_MODEL ? undefined : configuredModel;

  if (!HARNESSES.includes(harness)) {
    throw new HTTPException(400, { message: `未知 harness: ${harness}` });
  }
  validateInput?.(harness);

  const mode = profile.persona?.runtime ?? (harness === "pi" ? "local" : "sandbox");
  const disabledTools = validateDisabledTools(harness, profile.persona?.disabledTools ?? []);
  return { profile, harness, modelId, mode, disabledTools, tableId };
}

/** Product policy stays identical across embedded and remote execution. */
export function buildChatAgentInstructions(configuration: Awaited<ReturnType<typeof resolveChatAgentConfiguration>>, context: Awaited<ReturnType<typeof resolveChatContext>>, skillInstructions: string) {
  const { profile, harness, modelId } = configuration;
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
    skillInstructions,
    `当前智能体: ${profile.displayName}`,
    `当前 harness: ${harness} / model: ${modelId ?? "默认模型"}（Harness 创建时锁定，模型来自智能体配置）`,
  ].join("\n");

  return { agentsDocument, system };
}
