import { DISABLED_TOOLS_SCHEMA, PLATFORM_TOOL_IDS, type AgentToolCatalog, type AgentToolCatalogItem } from "@tabdo/shared";
import { HTTPException } from "hono/http-exception";
import type { ToolSet } from "ai";
import type { HarnessId } from "../ai/model.js";
import { createTableTools } from "../ai/tools.js";

const harnesses: HarnessId[] = ["pi", "codex", "claude"];
// Definitions only: no runtime, credentials, or tool execution during catalog reads.
const platformTools: ToolSet = createTableTools();
function group(id: string) {
  if (id.includes("report")) return "报告";
  if (id.includes("automation")) return "自动化";
  if (id.includes("form")) return "表单";
  if (id.includes("view") || id === "open_preview") return "视图";
  if (id.includes("relation")) return "关联记录";
  return "表格与记录";
}

export function getAgentToolCatalog(harness: HarnessId): AgentToolCatalog {
  // Official inactiveTools supports host tools without filtering native tools.
  const supportsFiltering = true;
  const tools: AgentToolCatalogItem[] = Object.entries(platformTools).map(([id, definition]) => ({
    id, name: id, description: typeof definition.description === "string" ? definition.description : id, group: group(id), source: "platform", supportedHarnesses: harnesses,
  }));
  return { harness, supportsFiltering, tools };
}

/** Normalize only known retired/native IDs; unknown IDs still fail at save/start. */
export function validateDisabledTools(harness: HarnessId, disabledTools: readonly string[] = []): (typeof PLATFORM_TOOL_IDS)[number][] {
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
