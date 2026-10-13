import type { HarnessV1 } from "@ai-sdk/harness";
import { createPi } from "@ai-sdk/harness-pi";
import { createCodex } from "@ai-sdk/harness-codex";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { DISABLED_TOOLS_SCHEMA, type AgentToolCatalog, type AgentToolCatalogItem } from "@tabdo/shared";
import { HTTPException } from "hono/http-exception";
import type { ToolSet } from "ai";
import type { HarnessId } from "../ai/model.js";
import { createTableTools } from "../ai/tools.js";
import { createTaskTools } from "./tasks.js";

const harnesses: HarnessId[] = ["pi", "codex", "claude"];
// Metadata construction does not open a runtime, discover credentials, or execute a tool.
const adapters: Record<HarnessId, HarnessV1> = {
  pi: createPi({ auth: {} }),
  codex: createCodex({ auth: {} }),
  claude: createClaudeCode({ auth: {} }),
};
const taskTools = createTaskTools({ id: "00000000-0000-4000-8000-000000000000", threadId: "00000000-0000-4000-8000-000000000000" });
const platformTools: ToolSet = { ...createTableTools(), ...taskTools };
function group(id: string) {
  if (id in taskTools) return "工作计划";
  if (id.includes("report")) return "报告";
  if (id.includes("automation")) return "自动化";
  if (id.includes("form")) return "表单";
  if (id.includes("view") || id === "open_preview") return "视图";
  if (id.includes("relation")) return "关联记录";
  return "表格与记录";
}

export function getAgentToolCatalog(harness: HarnessId): AgentToolCatalog {
  const adapter = adapters[harness];
  const supportsFiltering = adapter.supportsBuiltinToolFiltering === true || adapter.supportsBuiltinToolApprovals === true;
  const tools: AgentToolCatalogItem[] = Object.entries(platformTools).map(([id, definition]) => ({
    id, name: id, description: typeof definition.description === "string" ? definition.description : id, group: group(id), source: "platform", supportedHarnesses: harnesses,
  }));
  tools.push({ id: "read_skill", name: "read_skill", description: "读取此智能体已启用的 Skill 内容。关闭后无法通过此平台工具检索；Harness 原生 Skill 文件仍按 Skill 配置提供。", group: "Skills", source: "platform", supportedHarnesses: harnesses });
  for (const [id, definition] of Object.entries(adapter.builtinTools ?? {})) {
    tools.push({ id, name: id, description: typeof definition.description === "string" ? definition.description : id, group: "Harness 内置", source: "builtin", supportedHarnesses: harnesses.filter(key => id in (adapters[key].builtinTools ?? {})), ...(!supportsFiltering ? { alwaysEnabled: true } : {}) });
  }
  return { harness, supportsFiltering, tools };
}

/** Reject incompatible IDs at save/start; never silently discard a disabled entry. */
export function validateDisabledTools(harness: HarnessId, disabledTools: readonly string[] = []): string[] {
  const parsed = DISABLED_TOOLS_SCHEMA.safeParse(disabledTools);
  if (!parsed.success) throw new HTTPException(400, { message: "工具配置包含未知或重复的工具名称" });
  const catalog = getAgentToolCatalog(harness);
  const known = new Map(catalog.tools.map(item => [item.id, item]));
  for (const id of parsed.data) {
    const item = known.get(id);
    if (!item) throw new HTTPException(400, { message: `工具 ${id} 不属于 ${harness} Harness` });
    if (item.alwaysEnabled) throw new HTTPException(400, { message: `当前 Harness 不支持关闭工具 ${id}` });
  }
  return parsed.data;
}
